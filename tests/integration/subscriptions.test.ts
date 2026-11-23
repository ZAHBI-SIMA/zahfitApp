/**
 * Sprint 3 — cycle de vie des abonnements contre PostgreSQL (RLS actif).
 * « Aujourd'hui » est figé pour des résultats reproductibles.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import { createMember } from "@/modules/members/members.service";
import { createPlan, type PlanInput } from "@/modules/plans/plans.service";
import { isoDate, parseCalendarDate } from "@/modules/subscriptions/dates";
import {
  assignSubscription,
  cancelSubscription,
  dashboardStats,
  freezeSubscription,
  recordManualPayment,
  subscriptionReport,
  unfreezeSubscription,
} from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const d = (iso: string) => parseCalendarDate(iso)!;
const TODAY = d("2027-03-10");

const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `sub-a-${run}` };
const B = { tenantId: randomUUID(), userId: `sub-b-${run}` };
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);

const planInput = (name: string, priceXof: number, extra: Partial<PlanInput> = {}): PlanInput => ({
  name,
  description: null,
  priceXof,
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

let monthly = "";
let free = "";
let noFreeze = "";
let phoneSeq = 0;

async function newMember() {
  phoneSeq++;
  return inA((tx) =>
    createMember(tx, A, {
      firstName: "Test",
      lastName: `M${phoneSeq}`,
      phone: `+22507123400${String(phoneSeq).padStart(2, "0")}`,
      email: null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    }),
  );
}

/** Adhérent avec un mensuel payé du 5 mars au 4 avril 2027. */
async function memberWithActiveMonthly() {
  const member = await newMember();
  const sub = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: d("2027-03-05") }, TODAY));
  await inA((tx) => recordManualPayment(tx, A, sub.id, { method: "CASH", providerRef: null }));
  return { member, sub };
}

beforeAll(async () => {
  await owner.user.createMany({
    data: [
      { id: A.userId, name: "Admin A", email: `${A.userId}@test.local` },
      { id: B.userId, name: "Admin B", email: `${B.userId}@test.local` },
    ],
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `sa-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `sb-${run}`, name: "Salle B" },
    ],
  });
  monthly = (await inA((tx) => createPlan(tx, A, planInput("Mensuel", 20_000)))).id;
  free = (await inA((tx) => createPlan(tx, A, planInput("Essai", 0, { durationValue: 7, durationUnit: "DAY" })))).id;
  noFreeze = (await inA((tx) => createPlan(tx, A, planInput("Sans gel", 10_000, { maxFreezeDays: 0 })))).id;
});

afterAll(async () => {
  const tenants = { in: [A.tenantId, B.tenantId] };
  await owner.cashMovement.deleteMany({ where: { tenantId: tenants } }); // mouvements de caisse des paiements en espèces
  await owner.receipt.deleteMany({ where: { tenantId: tenants } }); // les reçus référencent les paiements
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

describe("Activation par le paiement", () => {
  it("un abonnement payant naît en attente et ne s'active qu'à l'encaissement", async () => {
    const member = await newMember();
    const sub = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    expect(sub.status).toBe("PENDING_PAYMENT");
    expect([isoDate(sub.startDate), isoDate(sub.endDate)]).toEqual(["2027-03-10", "2027-04-09"]);

    const { payment } = await inA((tx) =>
      recordManualPayment(tx, A, sub.id, { method: "MOBILE_MONEY", providerRef: `OM-${run}` }),
    );
    expect(payment.amountXof).toBe(20_000);
    expect(payment.status).toBe("SUCCEEDED");
    const after = await owner.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe("ACTIVE");
  });

  it("une référence de transaction ne peut pas servir deux fois", async () => {
    const member = await newMember();
    const sub = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    await expect(
      inA((tx) => recordManualPayment(tx, A, sub.id, { method: "MOBILE_MONEY", providerRef: `OM-${run}` })),
    ).rejects.toThrow(/déjà enregistrée/);
  });

  it("une formule gratuite s'active sans paiement", async () => {
    const member = await newMember();
    const sub = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: free, startDate: null }, TODAY));
    const after = await owner.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { payments: true } });
    expect(after.status).toBe("ACTIVE");
    expect(after.payments).toHaveLength(0);
  });

  it("refuse un second abonnement tant qu'un autre attend son paiement", async () => {
    const member = await newMember();
    await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    await expect(
      inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY)),
    ).rejects.toThrow(/attend déjà son paiement/);
  });
});

describe("Renouvellement", () => {
  it("anticipé : démarre au lendemain de la fin, chaîné au précédent, historique conservé", async () => {
    const { member, sub } = await memberWithActiveMonthly();
    const renewal = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    expect(isoDate(renewal.startDate)).toBe("2027-04-05");
    expect(renewal.previousId).toBe(sub.id);
    const original = await owner.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(isoDate(original.endDate)).toBe("2027-04-04"); // jamais écrasé
  });

  it("refuse un chevauchement de dates", async () => {
    const { member } = await memberWithActiveMonthly();
    await expect(
      inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: d("2027-03-20") }, TODAY)),
    ).rejects.toThrow(/Chevauche/);
  });
});

describe("Suspension", () => {
  it("repousse la fin des jours gelés ET décale le renouvellement déjà prévu", async () => {
    const { member, sub } = await memberWithActiveMonthly();
    const renewal = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    await inA((tx) => freezeSubscription(tx, A, sub.id, TODAY));
    const result = await inA((tx) => unfreezeSubscription(tx, A, sub.id, d("2027-03-15")));
    expect(result.credited).toBe(5);

    const [frozenOne, next] = await Promise.all([
      owner.subscription.findUniqueOrThrow({ where: { id: sub.id } }),
      owner.subscription.findUniqueOrThrow({ where: { id: renewal.id } }),
    ]);
    expect(isoDate(frozenOne.endDate)).toBe("2027-04-09");
    expect(isoDate(next.startDate)).toBe("2027-04-10"); // plus de chevauchement
  });

  it("refuse la suspension si la formule ne la prévoit pas", async () => {
    const member = await newMember();
    const sub = await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: noFreeze, startDate: null }, TODAY));
    await inA((tx) => recordManualPayment(tx, A, sub.id, { method: "CASH", providerRef: null }));
    await expect(inA((tx) => freezeSubscription(tx, A, sub.id, TODAY))).rejects.toThrow(/ne permet pas/);
  });
});

describe("Annulation", () => {
  it("un abonnement payé ne s'annule qu'avec le droit adéquat", async () => {
    const { sub } = await memberWithActiveMonthly();
    await expect(
      inA((tx) => cancelSubscription(tx, A, { subscriptionId: sub.id, reason: "test" }, { canCancelPaid: false })),
    ).rejects.toThrow(/gérant ou un administrateur/);
    const result = await inA((tx) => cancelSubscription(tx, A, { subscriptionId: sub.id, reason: "test" }, { canCancelPaid: true }));
    expect(result.paid).toBe(true);
  });
});

describe("Listes, indicateurs et isolation", () => {
  it("« à renouveler » liste les fins proches non renouvelées", async () => {
    const member = await newMember();
    const sub = await inA((tx) =>
      assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: d("2027-02-14") }, d("2027-02-14")),
    ); // fin 13 mars
    await inA((tx) => recordManualPayment(tx, A, sub.id, { method: "CASH", providerRef: null }));
    let list = await inA((tx) => subscriptionReport(tx, "a-renouveler", TODAY));
    expect(list.map((s) => s.id)).toContain(sub.id);

    await inA((tx) => assignSubscription(tx, A, { memberId: member.id, planId: monthly, startDate: null }, TODAY));
    list = await inA((tx) => subscriptionReport(tx, "a-renouveler", TODAY));
    expect(list.map((s) => s.id)).not.toContain(sub.id); // renouvelé (même en attente de paiement)
  });

  it("le chiffre d'affaires ne compte que les paiements confirmés", async () => {
    const stats = await inA((tx) => dashboardStats(tx, d("2020-01-01")));
    const confirmed = await owner.payment.aggregate({
      where: { tenantId: A.tenantId, status: "SUCCEEDED" },
      _sum: { amountXof: true },
    });
    expect(stats.revenueMonth).toBe(confirmed._sum.amountXof);
    expect(stats.pending).toBeGreaterThan(0); // en attente ≠ chiffre d'affaires
  });

  it("une autre salle ne voit ni les abonnements ni les paiements, ni la formule", async () => {
    const counts = await withTenant(B.tenantId, B.userId, async (tx) => ({
      subs: await tx.subscription.count(),
      payments: await tx.payment.count(),
      plan: await tx.membershipPlan.findUnique({ where: { id: monthly } }),
    }));
    expect(counts).toEqual({ subs: 0, payments: 0, plan: null });
  });

  it("le rôle applicatif ne peut pas supprimer un paiement", async () => {
    await expect(inA((tx) => tx.payment.deleteMany({}))).rejects.toThrow(/42501/);
  });
});
