/**
 * Sprint 14 — Support et onboarding, contre PostgreSQL (RLS actif) :
 * tickets et notes internes, cloisonnement entre salles, historique figé,
 * accès du support (« se connecter en tant que ») audité et visible par la
 * salle, assistant de démarrage.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withPlatform, withTenant, type Tx } from "@/lib/db";
import { createMember } from "@/modules/members/members.service";
import { finishOnboarding, onboardingState, skipOnboardingStep } from "@/modules/onboarding/onboarding.service";
import { createPlan } from "@/modules/plans/plans.service";
import {
  closeTicketAsTenant,
  createTicket,
  endSupportAccess,
  findActiveSupportAccess,
  listSupportAccesses,
  loadTicket,
  replyAsPlatform,
  replyAsTenant,
  startSupportAccess,
  updateTicketAsPlatform,
} from "@/modules/support/support.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `sup-a-${run}` };
const B = { tenantId: randomUUID(), userId: `sup-b-${run}` };
const RECEPTION = `sup-r-${run}`;
const MEMBER_USER = `sup-m-${run}`;
const AGENT = { id: `sup-p-${run}`, name: "Agent ZahDigit" };
const AGENT2 = `sup-p2-${run}`;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const inB = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(B.tenantId, B.userId, fn);
const asAgent = <T>(fn: (tx: Tx) => Promise<T>) => withPlatform(AGENT.id, fn);
const users = [A.userId, B.userId, RECEPTION, MEMBER_USER, AGENT.id, AGENT2];

let ticketId = "";

beforeAll(async () => {
  await owner.user.createMany({ data: users.map((id) => ({ id, name: id, email: `${id}@test.local` })) });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `sup-a-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `sup-b-${run}`, name: "Salle B" },
    ],
  });
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: A.tenantId, userId: A.userId, role: "ADMIN" },
      { tenantId: A.tenantId, userId: RECEPTION, role: "RECEPTIONIST" },
      { tenantId: A.tenantId, userId: MEMBER_USER, role: "MEMBER" },
      { tenantId: B.tenantId, userId: B.userId, role: "ADMIN" },
    ],
  });
});

afterAll(async () => {
  const where = { tenantId: { in: [A.tenantId, B.tenantId] } };
  await owner.supportAccess.deleteMany({ where });
  await owner.supportTicketMessage.deleteMany({ where });
  await owner.supportTicket.deleteMany({ where });
  await owner.member.deleteMany({ where });
  await owner.membershipPlan.deleteMany({ where });
  await owner.auditLog.deleteMany({ where });
  await owner.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await owner.tenantMembership.deleteMany({ where });
  await owner.tenant.deleteMany({ where: { id: { in: [A.tenantId, B.tenantId] } } });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Tickets", () => {
  it("la salle ouvre un ticket : en attente du support, premier message, journalisé", async () => {
    const { ticket } = await inA((tx) =>
      createTicket(tx, A, { subject: "Scan QR refusé", category: "TECHNICAL", priority: "HIGH", body: "Abonné à jour refusé." }),
    );
    ticketId = ticket.id;
    expect(ticket).toMatchObject({ status: "OPEN", priority: "HIGH", createdById: A.userId });
    expect(ticket.number).toBeGreaterThan(0);
    const audit = await owner.auditLog.findFirst({ where: { entityId: ticket.id, action: "support_ticket.create" } });
    expect(audit?.tenantId).toBe(A.tenantId);
  });

  it("note interne invisible pour la salle ; réponse publique → réponse attendue", async () => {
    await asAgent((tx) => replyAsPlatform(tx, AGENT.id, { ticketId, body: "Vérifier le fuseau", internal: true }));
    const { mails } = await asAgent((tx) =>
      replyAsPlatform(tx, AGENT.id, { ticketId, body: "Pouvez-vous réessayer ?", internal: false }),
    );
    expect(mails.map((m) => m.to)).toEqual([`${A.userId}@test.local`]);

    const forTenant = await inA((tx) => loadTicket(tx, ticketId));
    expect(forTenant?.messages.some((m) => m.kind === "INTERNAL_NOTE")).toBe(false);
    expect(forTenant).toMatchObject({ status: "WAITING_CUSTOMER", assignedToId: AGENT.id });
    expect(forTenant?.firstResponseAt).not.toBeNull();
    const forPlatform = await asAgent((tx) => loadTicket(tx, ticketId));
    expect(forPlatform?.messages.filter((m) => m.kind === "INTERNAL_NOTE")).toHaveLength(1);
  });

  it("la réponse de la salle remet le ticket dans la file de ZahDigit", async () => {
    await inA((tx) => replyAsTenant(tx, A, { ticketId, body: "Toujours refusé." }));
    const ticket = await owner.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("OPEN");
  });

  it("une autre salle ne voit ni ne modifie le ticket", async () => {
    expect(await inB((tx) => loadTicket(tx, ticketId))).toBeNull();
    await expect(inB((tx) => replyAsTenant(tx, B, { ticketId, body: "intrusion" }))).rejects.toThrow(/introuvable/);
  });

  it("la salle ne priorise pas, n'attribue pas, n'écrit ni note interne ni message au nom de ZahDigit", async () => {
    await expect(
      inA((tx) => tx.supportTicket.update({ where: { id: ticketId }, data: { priority: "URGENT" } })),
    ).rejects.toThrow();
    await expect(
      inA((tx) => tx.supportTicket.update({ where: { id: ticketId }, data: { status: "RESOLVED" } })),
    ).rejects.toThrow();
    await expect(
      inA((tx) =>
        tx.supportTicketMessage.create({
          data: { tenantId: A.tenantId, ticketId, authorId: A.userId, fromPlatform: false, kind: "INTERNAL_NOTE", body: "x" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      inA((tx) =>
        tx.supportTicketMessage.create({
          data: { tenantId: A.tenantId, ticketId, authorId: A.userId, fromPlatform: true, body: "Le support dit oui" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("historique figé : aucun message ne se modifie ni ne s'efface", async () => {
    await expect(
      asAgent((tx) => tx.supportTicketMessage.updateMany({ where: { ticketId }, data: { body: "réécrit" } })),
    ).rejects.toThrow();
    await expect(asAgent((tx) => tx.supportTicketMessage.deleteMany({ where: { ticketId } }))).rejects.toThrow();
    await expect(asAgent((tx) => tx.supportTicket.deleteMany({ where: { id: ticketId } }))).rejects.toThrow();
  });

  it("ticket clos : définitif, plus aucune réponse", async () => {
    await asAgent((tx) =>
      updateTicketAsPlatform(tx, AGENT.id, { ticketId, priority: "HIGH", status: "RESOLVED", assignToMe: false }),
    );
    await inA((tx) => closeTicketAsTenant(tx, A, ticketId));
    const ticket = await owner.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("CLOSED");
    expect(ticket.closedAt).not.toBeNull();
    await expect(inA((tx) => replyAsTenant(tx, A, { ticketId, body: "encore" }))).rejects.toThrow(/clos/);
    await expect(
      asAgent((tx) => tx.supportTicket.update({ where: { id: ticketId }, data: { status: "OPEN", closedAt: null } })),
    ).rejects.toThrow();
  });
});

describe("Accès du support (« se connecter en tant que »)", () => {
  let accessId = "";

  it("ouverture : lecture seule d'un compte du personnel, journalisée, annoncée aux administrateurs", async () => {
    const { access, mails } = await asAgent((tx) =>
      startSupportAccess(tx, AGENT, { tenantId: A.tenantId, targetUserId: RECEPTION, reason: "Vérifier l'écran d'accueil", minutes: 60 }),
    );
    accessId = access.id;
    expect(access).toMatchObject({ targetRole: "RECEPTIONIST", platformUserId: AGENT.id, endedAt: null });
    expect(mails.map((m) => m.to)).toEqual([`${A.userId}@test.local`]);
    const audit = await owner.auditLog.findFirst({ where: { entityId: access.id, action: "support.access.start" } });
    expect(audit).toMatchObject({ tenantId: A.tenantId, actorUserId: AGENT.id });
  });

  it("la salle voit l'accès ; une autre salle non", async () => {
    expect((await inA((tx) => listSupportAccesses(tx, A.tenantId))).map((a) => a.id)).toContain(accessId);
    expect(await inB((tx) => listSupportAccesses(tx, A.tenantId))).toHaveLength(0);
  });

  it("l'accès n'est utilisable que par l'agent qui l'a ouvert", async () => {
    expect(await asAgent((tx) => findActiveSupportAccess(tx, accessId, AGENT.id))).not.toBeNull();
    expect(await withPlatform(AGENT2, (tx) => findActiveSupportAccess(tx, accessId, AGENT2))).toBeNull();
  });

  it("jamais l'espace d'un adhérent ; 2 heures au plus ; jamais ouvert par la salle", async () => {
    await expect(
      asAgent((tx) =>
        startSupportAccess(tx, AGENT, { tenantId: A.tenantId, targetUserId: MEMBER_USER, reason: "Voir son QR code", minutes: 30 }),
      ),
    ).rejects.toThrow(/adhérent/);
    const now = new Date();
    const forged = (platformUserId: string, hours: number) => ({
      tenantId: A.tenantId,
      platformUserId,
      targetUserId: RECEPTION,
      targetRole: "RECEPTIONIST" as const,
      reason: "Accès forgé pour le test",
      startedAt: now,
      expiresAt: new Date(now.getTime() + hours * 3_600_000),
    });
    await expect(asAgent((tx) => tx.supportAccess.create({ data: forged(AGENT.id, 3) }))).rejects.toThrow();
    await expect(inA((tx) => tx.supportAccess.create({ data: forged(A.userId, 0.5) }))).rejects.toThrow();
  });

  it("trace infalsifiable : motif non modifiable, fin enregistrée une seule fois, aucune suppression", async () => {
    await expect(
      asAgent((tx) => tx.supportAccess.update({ where: { id: accessId }, data: { reason: "Motif réécrit après coup" } })),
    ).rejects.toThrow();
    expect(await asAgent((tx) => endSupportAccess(tx, AGENT.id))).toBe(A.tenantId);
    const ended = await owner.supportAccess.findUniqueOrThrow({ where: { id: accessId } });
    expect(ended.endedAt).not.toBeNull();
    expect(await asAgent((tx) => findActiveSupportAccess(tx, accessId, AGENT.id))).toBeNull();
    await expect(
      asAgent((tx) => tx.supportAccess.update({ where: { id: accessId }, data: { endedAt: new Date() } })),
    ).rejects.toThrow();
    await expect(asAgent((tx) => tx.supportAccess.deleteMany({ where: { id: accessId } }))).rejects.toThrow();
  });
});

describe("Assistant de démarrage", () => {
  it("avancement déduit des données ; « Passer » mémorisé ; fin exigeant une formule", async () => {
    let state = await inB((tx) => onboardingState(tx, B.tenantId));
    expect(state.settled).toBe(0);
    expect(state.next).toBe("salle");

    for (const step of ["salle", "adherents", "encaissements", "equipe"] as const) {
      await inB((tx) => skipOnboardingStep(tx, B, step));
    }
    await expect(inB((tx) => finishOnboarding(tx, B))).rejects.toThrow(/formule/);

    await inB((tx) =>
      createPlan(tx, B, {
        name: "Mensuel",
        description: null,
        priceXof: 20_000,
        durationValue: 1,
        durationUnit: "MONTH",
        benefits: [],
        allowedDays: [],
        accessFrom: null,
        accessUntil: null,
        maxEntries: null,
        maxFreezeDays: 0,
        isActive: true,
      }),
    );
    await inB((tx) =>
      createMember(tx, B, {
        firstName: "Awa",
        lastName: "Koné",
        phone: "+2250512349901",
        email: null,
        birthDate: null,
        consentWhatsapp: false,
        consentSms: false,
        consentEmail: false,
      }),
    );
    state = await inB((tx) => onboardingState(tx, B.tenantId));
    expect(state.steps.find((s) => s.key === "formules")?.done).toBe(true);
    // Une étape passée puis réalisée compte comme faite.
    expect(state.steps.find((s) => s.key === "adherents")).toMatchObject({ done: true, skipped: false });
    expect(state.next).toBeNull();

    await inB((tx) => finishOnboarding(tx, B));
    expect((await inB((tx) => onboardingState(tx, B.tenantId))).doneAt).not.toBeNull();
  });
});
