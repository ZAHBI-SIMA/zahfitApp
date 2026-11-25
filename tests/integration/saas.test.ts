/**
 * Sprint 12 — Forfaits SaaS : modules, limites et usage, contre PostgreSQL
 * (RLS actif, rôle applicatif).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withPlatform, withTenant, type Tx } from "@/lib/db";
import { createMember, setMemberArchived } from "@/modules/members/members.service";
import { notifyMember } from "@/modules/notifications/notifications.service";
import { loadPublicTenant } from "@/modules/payments/online.service";
import { assertTenantFeature, changeTenantPlan, tenantUsage, whatsappRemaining } from "@/modules/saas/saas.service";
import { addStaffMember } from "@/modules/staff/staff.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const STARTER_ID = "00000000-0000-7000-8000-000000000001";
const PREMIUM_ID = "00000000-0000-7000-8000-000000000003";
const TEST_PLAN = randomUUID();
const T = { tenantId: randomUUID(), userId: `saas-t-${run}` }; // forfait de test (limites basses)
const S = { tenantId: randomUUID(), userId: `saas-s-${run}` }; // Starter
const PLATFORM_USER = `saas-p-${run}`;
const EXTRA_STAFF = [`saas-x1-${run}`, `saas-x2-${run}`];
const inT = <R>(fn: (tx: Tx) => Promise<R>) => withTenant(T.tenantId, T.userId, fn);
let seq = 0;

const member = (tenant: { tenantId: string; userId: string }, consents = { whatsapp: false, sms: false }) => {
  seq++;
  return withTenant(tenant.tenantId, tenant.userId, (tx) =>
    createMember(tx, tenant, {
      firstName: "Forfait",
      lastName: `F${seq}`,
      phone: `+225017777${String(1000 + seq)}`,
      email: null,
      birthDate: null,
      consentWhatsapp: consents.whatsapp,
      consentSms: consents.sms,
      consentEmail: false,
    }),
  );
};

beforeAll(async () => {
  await owner.user.createMany({
    data: [T.userId, S.userId, PLATFORM_USER, ...EXTRA_STAFF].map((id) => ({ id, name: id, email: `${id}@test.local` })),
  });
  await owner.saasPlan.create({
    data: {
      id: TEST_PLAN,
      code: `TEST_${run.toUpperCase().replace(/[^A-Z0-9]/g, "X")}`,
      name: "Test",
      monthlyPriceXof: 0,
      features: ["MESSAGING"],
      maxMembers: 2,
      maxStaff: 2,
      maxWhatsappPerMonth: 1,
    },
  });
  await owner.tenant.createMany({
    data: [
      {
        id: T.tenantId,
        slug: `saas-t-${run}`,
        name: "Forfait test",
        saasPlanId: TEST_PLAN,
        whatsappEnabled: true,
        smsEnabled: true,
      },
      { id: S.tenantId, slug: `saas-s-${run}`, name: "Forfait Starter", saasPlanId: STARTER_ID },
    ],
  });
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: T.tenantId, userId: T.userId, role: "ADMIN" },
      { tenantId: S.tenantId, userId: S.userId, role: "ADMIN" },
    ],
  });
});

afterAll(async () => {
  for (const tenantId of [T.tenantId, S.tenantId]) {
    const where = { tenantId };
    await owner.message.deleteMany({ where: { ...where, fallbackOfId: { not: null } } });
    await owner.message.deleteMany({ where });
    await owner.notification.deleteMany({ where });
    await owner.member.deleteMany({ where });
    await owner.auditLog.deleteMany({ where });
    await owner.tenantMembership.deleteMany({ where });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.auditLog.deleteMany({ where: { actorUserId: PLATFORM_USER } });
  await owner.saasPlan.delete({ where: { id: TEST_PLAN } });
  await owner.user.deleteMany({ where: { id: { in: [T.userId, S.userId, PLATFORM_USER, ...EXTRA_STAFF] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Modules du forfait", () => {
  it("Starter : boutique non incluse ; vitrine sans inscription en ligne", async () => {
    await expect(withTenant(S.tenantId, S.userId, (tx) => assertTenantFeature(tx, S.tenantId, "SHOP"))).rejects.toThrow(
      /n'est pas inclus dans votre forfait Starter/,
    );
    const vitrine = await loadPublicTenant(`saas-s-${run}`);
    expect(vitrine?.onlinePayments).toBe(false);
  });

  it("sans module WhatsApp/SMS : la notification reste dans l'application", async () => {
    const m = await member(S, { whatsapp: true, sms: true });
    await owner.tenant.update({ where: { id: S.tenantId }, data: { whatsappEnabled: true, smsEnabled: true } });
    await withTenant(S.tenantId, S.userId, (tx) =>
      notifyMember(tx, S.tenantId, m.id, "SESSION_CANCELLED", { className: "Yoga", when: "demain", reason: "test" }),
    );
    expect(await owner.notification.count({ where: { memberId: m.id } })).toBe(1);
    expect(await owner.message.count({ where: { memberId: m.id } })).toBe(0);
  });
});

describe("Limites", () => {
  it("adhérents actifs : refus au-delà, une place libérée par l'archivage", async () => {
    const first = await member(T);
    await member(T);
    await expect(member(T)).rejects.toThrow(/Limite du forfait Test : 2 adhérents actifs/);
    await inT((tx) => setMemberArchived(tx, T, first.id, true));
    await expect(member(T)).resolves.toBeDefined();
  });

  it("comptes de l'équipe : refus au-delà de la limite", async () => {
    await inT((tx) =>
      addStaffMember(tx, T, EXTRA_STAFF[0], { name: "X1", email: `${EXTRA_STAFF[0]}@test.local`, role: "COACH" }),
    );
    await expect(
      inT((tx) =>
        addStaffMember(tx, T, EXTRA_STAFF[1], { name: "X2", email: `${EXTRA_STAFF[1]}@test.local`, role: "COACH" }),
      ),
    ).rejects.toThrow(/2 comptes pour l'équipe/);
  });

  it("quota WhatsApp atteint : repli SMS", async () => {
    await owner.saasPlan.update({ where: { id: TEST_PLAN }, data: { maxMembers: null } });
    const m = await member(T, { whatsapp: true, sms: true });
    const notify = () =>
      inT((tx) =>
        notifyMember(tx, T.tenantId, m.id, "SESSION_CANCELLED", { className: "Yoga", when: "demain", reason: "test" }),
      );
    await notify();
    await notify();
    const channels = (await owner.message.findMany({ where: { memberId: m.id }, orderBy: { createdAt: "asc" } })).map(
      (x) => x.channel,
    );
    expect(channels).toEqual(["WHATSAPP", "SMS"]);
    expect(await inT((tx) => whatsappRemaining(tx, T.tenantId))).toBe(0);
  });

  it("usage mesuré par salle", async () => {
    const usage = await inT((tx) => tenantUsage(tx, T.tenantId));
    expect(usage.members).toEqual({ used: 3, limit: null }); // 4 créés, 1 archivé
    expect(usage.staff).toEqual({ used: 2, limit: 2 });
    expect(usage.whatsapp).toEqual({ used: 1, limit: 1 });
    expect(usage.sms).toBe(1);
  });
});

describe("Changement de forfait", () => {
  it("une salle ne peut ni changer de forfait ni modifier un forfait (garanti par la base)", async () => {
    await expect(
      inT((tx) => tx.tenant.update({ where: { id: T.tenantId }, data: { saasPlanId: PREMIUM_ID } })),
    ).rejects.toThrow();
    await expect(
      inT((tx) => tx.saasPlan.update({ where: { id: TEST_PLAN }, data: { maxMembers: 9999 } })),
    ).rejects.toThrow();
  });

  it("le Super Admin change le forfait : modules disponibles immédiatement, changement tracé", async () => {
    await withPlatform(PLATFORM_USER, (tx) => changeTenantPlan(tx, PLATFORM_USER, S.tenantId, PREMIUM_ID));
    await expect(
      withTenant(S.tenantId, S.userId, (tx) => assertTenantFeature(tx, S.tenantId, "SHOP")),
    ).resolves.toBeUndefined();
    expect(await owner.auditLog.count({ where: { tenantId: S.tenantId, action: "tenant.plan.change" } })).toBe(1);
  });
});
