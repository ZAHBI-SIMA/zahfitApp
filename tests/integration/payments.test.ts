/**
 * Sprint 4 — reçus, paiement partiel, remboursements contre PostgreSQL (RLS actif).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import { createMember } from "@/modules/members/members.service";
import { loadReceipt, netPaid, refundPayment } from "@/modules/payments/payments.service";
import { toReceiptPdfData } from "@/modules/payments/receipt-email";
import { renderReceiptPdf } from "@/modules/payments/receipt-pdf";
import { createPlan } from "@/modules/plans/plans.service";
import { todayCalendar } from "@/modules/subscriptions/dates";
import {
  assignSubscription,
  dashboardStats,
  recordManualPayment,
  subscriptionReport,
} from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `pay-a-${run}` };
const B = { tenantId: randomUUID(), userId: `pay-b-${run}` };
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const inB = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(B.tenantId, B.userId, fn);
const TODAY = todayCalendar();
const CASH = { method: "CASH" as const, providerRef: null };

let planA = "";
let planB = "";
let seq = 0;

async function pendingSubscription(actor: typeof A, plan: string) {
  seq++;
  const scope = actor === A ? inA : inB;
  const member = await scope((tx) =>
    createMember(tx, actor, {
      firstName: "Pay",
      lastName: `T${seq}`,
      phone: `+22505123400${String(seq).padStart(2, "0")}`,
      email: null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    }),
  );
  return scope((tx) => assignSubscription(tx, actor, { memberId: member.id, planId: plan, startDate: null }, TODAY));
}

beforeAll(async () => {
  await owner.user.createMany({
    data: [
      { id: A.userId, name: "Caissière A", email: `${A.userId}@test.local` },
      { id: B.userId, name: "Caissière B", email: `${B.userId}@test.local` },
    ],
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `pa-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `pb-${run}`, name: "Salle B" },
    ],
  });
  const plan = {
    description: null,
    priceXof: 20_000,
    durationValue: 1,
    durationUnit: "MONTH" as const,
    benefits: [],
    allowedDays: [],
    accessFrom: null,
    accessUntil: null,
    maxEntries: null,
    maxFreezeDays: 0,
    isActive: true,
  };
  planA = (await inA((tx) => createPlan(tx, A, { ...plan, name: "Mensuel" }))).id;
  planB = (await inB((tx) => createPlan(tx, B, { ...plan, name: "Mensuel" }))).id;
});

afterAll(async () => {
  const tenants = { in: [A.tenantId, B.tenantId] };
  await owner.receipt.deleteMany({ where: { tenantId: tenants } });
  await owner.payment.updateMany({ where: { tenantId: tenants }, data: { refundOfId: null, kind: "PAYMENT" } });
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

describe("Reçus numérotés", () => {
  it("numérotation continue par salle, indépendante d'une salle à l'autre", async () => {
    const s1 = await pendingSubscription(A, planA);
    const s2 = await pendingSubscription(A, planA);
    const sb = await pendingSubscription(B, planB);
    const r1 = await inA((tx) => recordManualPayment(tx, A, s1.id, CASH));
    const r2 = await inA((tx) => recordManualPayment(tx, A, s2.id, CASH));
    const rb = await inB((tx) => recordManualPayment(tx, B, sb.id, CASH));
    expect([r1.receipt.number, r2.receipt.number, rb.receipt.number]).toEqual(["REC-000001", "REC-000002", "REC-000001"]);
  });

  it("un encaissement refusé ne consomme pas de numéro", async () => {
    const s = await pendingSubscription(A, planA);
    await expect(inA((tx) => recordManualPayment(tx, A, s.id, { ...CASH, amountXof: 25_000 }))).rejects.toThrow(/reste à payer/);
    const ok = await inA((tx) => recordManualPayment(tx, A, s.id, CASH));
    expect(ok.receipt.number).toBe("REC-000003");
  });

  it("un reçu ne peut être ni modifié ni supprimé par l'application", async () => {
    await expect(inA((tx) => tx.receipt.updateMany({ data: { number: "FAUX" } }))).rejects.toThrow(/42501/);
    await expect(inA((tx) => tx.receipt.deleteMany({}))).rejects.toThrow(/42501/);
  });
});

describe("Paiement partiel", () => {
  it("refusé tant que la salle ne l'autorise pas", async () => {
    const s = await pendingSubscription(A, planA);
    await expect(inA((tx) => recordManualPayment(tx, A, s.id, { ...CASH, amountXof: 10_000 }))).rejects.toThrow(
      /plusieurs fois/,
    );
  });

  it("acompte minimum, puis solde : impayés suivis et reçu figé à sa date", async () => {
    await owner.tenant.update({ where: { id: A.tenantId }, data: { allowPartialPayment: true, minDepositPercent: 50 } });
    const s = await pendingSubscription(A, planA);

    await expect(inA((tx) => recordManualPayment(tx, A, s.id, { ...CASH, amountXof: 5_000 }))).rejects.toThrow(/Acompte minimum/);

    const first = await inA((tx) => recordManualPayment(tx, A, s.id, { ...CASH, amountXof: 10_000 }));
    expect(first.balanceAfter).toBe(10_000);
    expect((await owner.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACTIVE");
    let unpaid = await inA((tx) => subscriptionReport(tx, "impayes", TODAY));
    expect(unpaid.find((u) => u.id === s.id)?.balanceXof).toBe(10_000);

    const second = await inA((tx) => recordManualPayment(tx, A, s.id, CASH)); // solde par défaut
    expect(second.payment.amountXof).toBe(10_000);
    unpaid = await inA((tx) => subscriptionReport(tx, "impayes", TODAY));
    expect(unpaid.some((u) => u.id === s.id)).toBe(false);

    // Réimprimer le 1er reçu donne toujours « payé 10 000, reste 10 000 ».
    const reprint = await inA((tx) => loadReceipt(tx, first.receipt.id));
    expect(reprint?.paidAtThatTime).toBe(10_000);
    const pdf = await renderReceiptPdf(toReceiptPdfData(reprint!));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
});

describe("Remboursements", () => {
  it("partiel puis total : avoir numéroté dans la même séquence, plafond respecté", async () => {
    const s = await pendingSubscription(A, planA);
    const { payment } = await inA((tx) => recordManualPayment(tx, A, s.id, CASH));

    const { receipt } = await inA((tx) => refundPayment(tx, A, { paymentId: payment.id, amountXof: 5_000, reason: "Geste" }));
    expect(receipt.number).toMatch(/^AV-\d{6}$/);
    expect(await inA((tx) => netPaid(tx, s.id))).toBe(15_000);

    await expect(
      inA((tx) => refundPayment(tx, A, { paymentId: payment.id, amountXof: 20_000, reason: "Trop" })),
    ).rejects.toThrow(/au maximum/);
    await inA((tx) => refundPayment(tx, A, { paymentId: payment.id, reason: "Départ" })); // reste remboursable
    await expect(inA((tx) => refundPayment(tx, A, { paymentId: payment.id, reason: "Encore" }))).rejects.toThrow(
      /entièrement remboursé/,
    );
    const original = await owner.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(original.status).toBe("SUCCEEDED"); // le paiement d'origine n'est jamais modifié
  });

  it("le chiffre d'affaires est net des remboursements", async () => {
    const stats = await inA((tx) => dashboardStats(tx, TODAY));
    const rows = await owner.payment.groupBy({
      by: ["kind"],
      where: { tenantId: A.tenantId, status: "SUCCEEDED" },
      _sum: { amountXof: true },
    });
    const sum = (k: string) => rows.find((r) => r.kind === k)?._sum.amountXof ?? 0;
    expect(stats.revenueToday).toBe(sum("PAYMENT") - sum("REFUND"));
    expect(sum("REFUND")).toBeGreaterThan(0);
  });

  it("une autre salle ne voit pas les reçus", async () => {
    const count = await inB((tx) => tx.receipt.count());
    expect(count).toBe(1); // uniquement le sien
  });
});
