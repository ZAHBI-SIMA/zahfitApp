/**
 * Sprint 6 — contrôle d'accès contre PostgreSQL (RLS actif).
 * « Maintenant » est figé : mercredi 10 mars 2027, 10:00 (Abidjan = UTC).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideOffline } from "@/components/access/offline-store";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import {
  accessOverview,
  accessSnapshot,
  checkAccess,
  issueBadge,
  revokeBadge,
  syncOfflineEvents,
} from "@/modules/access/access.service";
import { tenantDayKey } from "@/modules/access/keys";
import { buildQrToken, dayOfWindow, deriveMemberKey, windowOf } from "@/modules/access/token";
import { createMember } from "@/modules/members/members.service";
import { createPlan, updatePlan, type PlanInput } from "@/modules/plans/plans.service";
import { parseCalendarDate } from "@/modules/subscriptions/dates";
import { assignSubscription, freezeSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const d = (iso: string) => parseCalendarDate(iso)!;
const TODAY = d("2027-03-10");
const NOW = new Date("2027-03-10T10:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `acc-a-${run}` };
const B = { tenantId: randomUUID(), userId: `acc-b-${run}` };
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const inB = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(B.tenantId, B.userId, fn);

const planInput = (name: string, extra: Partial<PlanInput> = {}): PlanInput => ({
  name,
  description: null,
  priceXof: 20_000,
  durationValue: 1,
  durationUnit: "MONTH",
  benefits: [],
  allowedDays: [],
  accessFrom: null,
  accessUntil: null,
  maxEntries: null,
  maxFreezeDays: 10,
  isActive: true,
  ...extra,
});

const plans = { monthly: "", carnet: "", weekend: "", monthlyB: "" };
let phoneSeq = 0;

async function memberWith(planId: string | null, tenant = A) {
  phoneSeq++;
  const inT = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(tenant.tenantId, tenant.userId, fn);
  const member = await inT((tx) =>
    createMember(tx, tenant, {
      firstName: "Acc",
      lastName: `M${phoneSeq}`,
      phone: `+22505123400${String(phoneSeq).padStart(2, "0")}`,
      email: null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    }),
  );
  if (!planId) return { member, subId: null };
  const sub = await inT((tx) =>
    assignSubscription(tx, tenant, { memberId: member.id, planId, startDate: d("2027-03-05") }, TODAY),
  );
  await inT((tx) => recordManualPayment(tx, tenant, sub.id, { method: "CASH", providerRef: null }));
  return { member, subId: sub.id };
}

/** QR tel que le téléphone de l'adhérent le fabrique. */
async function qrFor(tenantId: string, memberId: string, at: Date = NOW, windowShift = 0) {
  const window = windowOf(at.getTime()) + windowShift;
  const memberKey = await deriveMemberKey(tenantDayKey(tenantId, dayOfWindow(window)), memberId);
  return buildQrToken(memberKey, memberId, window);
}

const scan = (credential: string, at: Date = NOW, clientEventId?: string) =>
  inA((tx) => checkAccess(tx, A, { credential, clientEventId }, at));

beforeAll(async () => {
  await owner.user.createMany({
    data: [
      { id: A.userId, name: "Accueil A", email: `${A.userId}@test.local` },
      { id: B.userId, name: "Accueil B", email: `${B.userId}@test.local` },
    ],
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `aa-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `ab-${run}`, name: "Salle B" },
    ],
  });
  plans.monthly = (await inA((tx) => createPlan(tx, A, planInput("Mensuel")))).id;
  plans.carnet = (await inA((tx) => createPlan(tx, A, planInput("Carnet 2", { maxEntries: 2 })))).id;
  plans.weekend = (await inA((tx) => createPlan(tx, A, planInput("Week-end", { allowedDays: [6, 7] })))).id;
  plans.monthlyB = (await inB((tx) => createPlan(tx, B, planInput("Mensuel B")))).id;
});

afterAll(async () => {
  const tenants = { in: [A.tenantId, B.tenantId] };
  await owner.accessLog.deleteMany({ where: { tenantId: tenants } });
  await owner.receipt.deleteMany({ where: { tenantId: tenants } });
  await owner.payment.deleteMany({ where: { tenantId: tenants } });
  await owner.subscription.updateMany({ where: { tenantId: tenants }, data: { previousId: null } });
  await owner.subscription.deleteMany({ where: { tenantId: tenants } });
  await owner.member.deleteMany({ where: { tenantId: tenants } });
  await owner.membershipPlan.deleteMany({ where: { tenantId: tenants } });
  await owner.auditLog.deleteMany({ where: { tenantId: tenants } });
  await owner.tenant.deleteMany({ where: { id: tenants } });
  await owner.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Scan du QR dynamique", () => {
  it("abonnement payé : accès autorisé et passage journalisé", async () => {
    const { member, subId } = await memberWith(plans.monthly);
    const result = await scan(await qrFor(A.tenantId, member.id));
    expect(result).toMatchObject({ granted: true, reason: "GRANTED", method: "QR" });
    expect(result.member?.code).toBe(member.code);
    const logs = await owner.accessLog.findMany({ where: { memberId: member.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ granted: true, subscriptionId: subId, scannedById: A.userId });
  });

  it("anti-passback : refusé 10 min après, autorisé 61 min après", async () => {
    const { member } = await memberWith(plans.monthly);
    expect((await scan(await qrFor(A.tenantId, member.id))).granted).toBe(true);
    const tooSoon = await scan(await qrFor(A.tenantId, member.id, later(10)), later(10));
    expect(tooSoon.reason).toBe("PASSBACK");
    expect((await scan(await qrFor(A.tenantId, member.id, later(61)), later(61))).granted).toBe(true);
  });

  it("QR périmé (capture d'écran) : refusé, mais l'adhérent est identifié", async () => {
    const { member } = await memberWith(plans.monthly);
    const result = await scan(await qrFor(A.tenantId, member.id, NOW, -3));
    expect(result.reason).toBe("EXPIRED_CODE");
    expect(result.member?.id).toBe(member.id);
  });

  it("QR d'une autre salle : non reconnu, aucun adhérent révélé", async () => {
    const { member } = await memberWith(plans.monthlyB, B);
    const result = await scan(await qrFor(B.tenantId, member.id));
    expect(result).toMatchObject({ granted: false, reason: "INVALID_CODE", member: null });
    // Le refus est journalisé dans la salle A, sans référence à l'adhérent de B.
    const log = await owner.accessLog.findFirst({ where: { tenantId: A.tenantId, reason: "INVALID_CODE" } });
    expect(log?.memberId).toBeNull();
  });

  it("abonnement suspendu (gel) ou sans abonnement : refus motivé", async () => {
    const frozen = await memberWith(plans.monthly);
    await inA((tx) => freezeSubscription(tx, A, frozen.subId!, TODAY));
    expect((await scan(await qrFor(A.tenantId, frozen.member.id))).reason).toBe("SUBSCRIPTION_FROZEN");
    const none = await memberWith(null);
    expect((await scan(await qrFor(A.tenantId, none.member.id))).reason).toBe("NO_SUBSCRIPTION");
  });

  it("formule week-end scannée un mercredi : jour non autorisé", async () => {
    const { member } = await memberWith(plans.weekend);
    expect((await scan(await qrFor(A.tenantId, member.id))).reason).toBe("DAY_NOT_ALLOWED");
  });
});

describe("Quota et restrictions figées à la vente", () => {
  it("carnet de 2 entrées : la 3e est refusée, même si la formule change ensuite", async () => {
    const { member, subId } = await memberWith(plans.carnet);
    // La formule passe en illimité APRÈS la vente : l'abonnement vendu garde ses 2 entrées.
    await inA((tx) => updatePlan(tx, A, plans.carnet, planInput("Carnet 2", { maxEntries: null })));
    expect((await owner.subscription.findUniqueOrThrow({ where: { id: subId! } })).maxEntries).toBe(2);

    const first = await scan(await qrFor(A.tenantId, member.id));
    expect(first.subscription?.entriesLeft).toBe(1);
    expect((await scan(await qrFor(A.tenantId, member.id, later(120)), later(120))).granted).toBe(true);
    const third = await scan(await qrFor(A.tenantId, member.id, later(240)), later(240));
    expect(third.reason).toBe("QUOTA_REACHED");
  });
});

describe("Badge physique", () => {
  it("émis → accepté ; renouvelé → l'ancien refusé ; révoqué → refusé", async () => {
    const { member } = await memberWith(plans.monthly);
    const { code: first } = await inA((tx) => issueBadge(tx, A, member.id));
    expect(first).toMatch(/^ZB-[2-9A-HJKMNP-Z]{10}$/);
    expect((await scan(first)).granted).toBe(true);

    const stored = await owner.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(stored.badgeHash).toMatch(/^[0-9a-f]{64}$/); // seule l'empreinte est stockée
    expect(stored.badgeHint).toBe(first.slice(-4));

    const { code: second } = await inA((tx) => issueBadge(tx, A, member.id));
    expect((await scan(first, later(120))).reason).toBe("UNKNOWN_BADGE");
    expect((await scan(second, later(121))).granted).toBe(true);

    await inA((tx) => revokeBadge(tx, A, member.id));
    expect((await scan(second, later(300))).reason).toBe("UNKNOWN_BADGE");
  });
});

describe("Fiabilité du journal", () => {
  it("même demande rejouée (réseau instable) : un seul passage compté", async () => {
    const { member } = await memberWith(plans.monthly);
    const id = randomUUID();
    const token = await qrFor(A.tenantId, member.id);
    const once = await scan(token, NOW, id);
    const again = await scan(token, NOW, id);
    expect(once.granted).toBe(true);
    expect(again.granted).toBe(true); // même réponse, pas un « anti-passback »
    expect(await owner.accessLog.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("le journal est en ajout seul pour l'application", async () => {
    await expect(inA((tx) => tx.accessLog.updateMany({ data: { granted: false } }))).rejects.toThrow(/42501/);
    await expect(inA((tx) => tx.accessLog.deleteMany({}))).rejects.toThrow(/42501/);
  });

  it("une salle ne voit pas les passages d'une autre (RLS)", async () => {
    expect(await inB((tx) => tx.accessLog.count({ where: { tenantId: A.tenantId } }))).toBe(0);
  });

  it("fréquentation du jour", async () => {
    const overview = await inA((tx) => accessOverview(tx, A.tenantId, later(600), 3));
    const today = overview.days.at(-1)!;
    expect(today.day).toBe("2027-03-10");
    expect(today.granted).toBeGreaterThan(0);
    expect(today.denied).toBeGreaterThan(0);
    expect(overview.hours.find((h) => h.hour === 10)!.n).toBeGreaterThan(0);
  });
});

describe("Mode hors ligne", () => {
  it("le cache ne contient ni téléphone ni code de badge", async () => {
    const { member } = await memberWith(plans.monthly);
    const { code } = await inA((tx) => issueBadge(tx, A, member.id));
    const snapshot = await inA((tx) => accessSnapshot(tx, A.tenantId, NOW));
    const cached = snapshot.members.find((m) => m.id === member.id)!;
    expect(cached).toBeDefined();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(member.phone);
    expect(serialized).not.toContain(code);
    expect(cached.badgeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(snapshot.dayKeys)).toEqual(["2027-03-10", "2027-03-11"]);
  });

  it("l'appareil décide comme le serveur, puis la synchronisation est idempotente", async () => {
    const { member } = await memberWith(plans.monthly);
    const snapshot = await inA((tx) => accessSnapshot(tx, A.tenantId, NOW));

    const first = await decideOffline(snapshot, await qrFor(A.tenantId, member.id, later(1)), randomUUID(), later(1));
    expect(first.result).toMatchObject({ granted: true, offline: true });
    // Le cache compte l'entrée : un second passage 5 min plus tard est refusé hors ligne aussi.
    const second = await decideOffline(snapshot, await qrFor(A.tenantId, member.id, later(6)), randomUUID(), later(6));
    expect(second.result.reason).toBe("PASSBACK");

    const events = [first.event, second.event];
    expect(await inA((tx) => syncOfflineEvents(tx, A, events, later(30)))).toMatchObject({ inserted: 2, rejected: 0 });
    expect(await inA((tx) => syncOfflineEvents(tx, A, events, later(31)))).toMatchObject({ inserted: 0 });
    const logs = await owner.accessLog.findMany({ where: { memberId: member.id }, orderBy: { occurredAt: "asc" } });
    expect(logs.map((l) => [l.granted, l.offline])).toEqual([
      [true, true],
      [false, true],
    ]);

    // De retour en ligne, le serveur tient compte de l'entrée faite hors ligne.
    expect((await scan(await qrFor(A.tenantId, member.id, later(20)), later(20))).reason).toBe("PASSBACK");
  });

  it("la synchronisation écarte un adhérent d'une autre salle et les dates incohérentes", async () => {
    const foreign = await memberWith(plans.monthlyB, B);
    const base = { method: "QR" as const, granted: false, reason: "INVALID_CODE" as const, subscriptionId: null };
    const result = await inA((tx) =>
      syncOfflineEvents(
        tx,
        A,
        [
          { ...base, clientEventId: randomUUID(), memberId: foreign.member.id, occurredAt: NOW.toISOString() },
          { ...base, clientEventId: randomUUID(), memberId: null, occurredAt: later(-60 * 24 * 30).toISOString() },
          { ...base, clientEventId: randomUUID(), memberId: null, occurredAt: later(60 * 24).toISOString() },
          {
            ...base,
            clientEventId: randomUUID(),
            memberId: null,
            granted: true,
            reason: "GRANTED",
            occurredAt: NOW.toISOString(),
          },
        ],
        later(1),
      ),
    );
    expect(result).toMatchObject({ received: 4, inserted: 0, rejected: 4 });
  });
});
