/**
 * Sprint 13 — Facturation ZahDigit : essai, factures, relances, lecture seule,
 * suspension et réactivation au paiement, contre PostgreSQL (RLS actif).
 * Les journées sont simulées en passant la date du jour au cycle quotidien.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withDbContext, withTenant, type Tx } from "@/lib/db";
import {
  applySaasPaymentStatus,
  markInvoicePaid,
  platformDashboard,
  runBillingCycle,
  startInvoicePayment,
  startTenantBilling,
  voidSaasInvoice,
} from "@/modules/billing/billing.service";
import { getProvider } from "@/modules/payments/providers";
import { addDays, parseCalendarDate } from "@/modules/subscriptions/dates";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const PLAN = randomUUID();
const T = { tenantId: randomUUID(), userId: `bill-${run}` };
const PLATFORM_USER = `bill-p-${run}`;
const T0 = parseCalendarDate("2027-03-01")!;
const day = (n: number) => addDays(T0, n);
const platform = <R>(fn: (tx: Tx) => Promise<R>) => withDbContext({ platform: true }, fn);
const sub = () => owner.tenantSubscription.findUniqueOrThrow({ where: { tenantId: T.tenantId } });
const invoices = () => owner.saasInvoice.findMany({ where: { tenantId: T.tenantId }, orderBy: { number: "asc" } });

beforeAll(async () => {
  await owner.user.createMany({
    data: [T.userId, PLATFORM_USER].map((id) => ({ id, name: id, email: `${id}@test.local` })),
  });
  await owner.saasPlan.create({
    data: {
      id: PLAN,
      code: `BILL_${run.toUpperCase().replace(/[^A-Z0-9]/g, "X")}`,
      name: "Facturation test",
      monthlyPriceXof: 30_000,
      setupFeeXof: 100_000,
      features: [],
    },
  });
  await owner.tenant.create({ data: { id: T.tenantId, slug: `bill-${run}`, name: "Salle facturée", saasPlanId: PLAN } });
  await owner.tenantMembership.create({ data: { tenantId: T.tenantId, userId: T.userId, role: "ADMIN" } });
  await platform((tx) => startTenantBilling(tx, PLATFORM_USER, T.tenantId, T0));
});

afterAll(async () => {
  const where = { tenantId: T.tenantId };
  await owner.saasPayment.deleteMany({ where });
  await owner.saasInvoice.deleteMany({ where });
  await owner.tenantSubscription.deleteMany({ where });
  await owner.auditLog.deleteMany({ where });
  await owner.auditLog.deleteMany({ where: { actorUserId: PLATFORM_USER } });
  await owner.tenantMembership.deleteMany({ where });
  await owner.tenant.delete({ where: { id: T.tenantId } });
  await owner.saasPlan.delete({ where: { id: PLAN } });
  await owner.user.deleteMany({ where: { id: { in: [T.userId, PLATFORM_USER] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Ouverture et retard", () => {
  it("essai de 30 jours et facture d'installation payable sous 7 jours", async () => {
    expect(await sub()).toMatchObject({ status: "TRIALING", trialEndsOn: day(30) });
    const [setup] = await invoices();
    expect(setup).toMatchObject({ kind: "SETUP", amountXof: 100_000, status: "OPEN", issuedOn: T0, dueOn: day(7) });
    expect(setup.number).toMatch(/^ZD-\d{6,}$/);
  });

  it("J+1 en retard, J+7 lecture seule, J+15 suspension (avec relances)", async () => {
    await runBillingCycle(day(4)); // J-3 : relance avant échéance
    await runBillingCycle(day(8));
    expect((await sub()).status).toBe("PAST_DUE");
    await runBillingCycle(day(14));
    expect((await sub()).status).toBe("READ_ONLY");
    await runBillingCycle(day(22));
    expect((await sub()).status).toBe("SUSPENDED");
    const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: T.tenantId } });
    expect(tenant.status).toBe("SUSPENDED");
    expect(tenant.suspendedReason).toMatch(/^Facture ZD-\d+ impayée/);
    expect((await invoices())[0].remindersSent).toEqual(["J-3", "J+1", "J+7", "J+15"]);
  });
});

describe("Règlement en ligne par la salle", () => {
  let paymentId = "";

  it("paiement Mobile Money : facture réglée, salle réactivée (toujours en essai)", async () => {
    const [setup] = await invoices();
    const sandbox = getProvider("sandbox")!;
    ({ paymentId } = await withTenant(T.tenantId, T.userId, (tx) =>
      startInvoicePayment(tx, T, setup.id, sandbox, () => ({ returnUrl: "http://test", notifyUrl: "http://test/webhook" })),
    ));
    expect((await applySaasPaymentStatus(paymentId, "SUCCEEDED", 100_000, day(22))).outcome).toBe("confirmed");
    expect((await invoices())[0]).toMatchObject({ status: "PAID", paymentMethod: "MOBILE_MONEY" });
    expect((await sub()).status).toBe("TRIALING");
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: T.tenantId } })).status).toBe("ACTIVE");
  });

  it("notification rejouée : sans effet", async () => {
    expect((await applySaasPaymentStatus(paymentId, "SUCCEEDED", 100_000, day(22))).outcome).toBe("already_processed");
  });
});

describe("Abonnement mensuel", () => {
  it("fin d'essai : première période facturée d'avance", async () => {
    await runBillingCycle(day(31));
    expect(await sub()).toMatchObject({ status: "ACTIVE", currentPeriodStart: day(31) });
    const monthly = (await invoices()).filter((i) => i.kind === "MONTHLY");
    expect(monthly).toHaveLength(1);
    expect(monthly[0]).toMatchObject({ amountXof: 30_000, periodStart: day(31), dueOn: day(38) });
  });

  it("rattrapage des périodes, sans doublon si la tâche repasse", async () => {
    const open = (await invoices()).find((i) => i.status === "OPEN")!;
    await platform((tx) =>
      markInvoicePaid(tx, PLATFORM_USER, { invoiceId: open.id, method: "TRANSFER", reference: "VIR-1" }, day(35)),
    );
    await runBillingCycle(day(95));
    await runBillingCycle(day(95));
    const monthly = (await invoices()).filter((i) => i.kind === "MONTHLY");
    expect(monthly.length).toBe(3);
    expect(new Set(monthly.map((i) => i.periodStart?.toISOString())).size).toBe(3);
  });

  it("annulation d'une facture par ZahDigit : plus due, statut recalculé", async () => {
    const open = (await invoices()).filter((i) => i.status === "OPEN");
    for (const i of open) {
      await platform((tx) => voidSaasInvoice(tx, PLATFORM_USER, { invoiceId: i.id, reason: "Geste commercial" }, day(95)));
    }
    expect((await sub()).status).toBe("ACTIVE");
    await expect(
      platform((tx) => voidSaasInvoice(tx, PLATFORM_USER, { invoiceId: open[0].id, reason: "Encore" }, day(95))),
    ).rejects.toThrow(/ouverte/);
  });
});

describe("Garanties de la base", () => {
  it("une salle ne peut ni régler, ni supprimer une facture, ni changer son abonnement", async () => {
    const [setup] = await invoices();
    await expect(
      withTenant(T.tenantId, T.userId, (tx) =>
        tx.saasInvoice.update({ where: { id: setup.id }, data: { status: "VOID", voidReason: "x" } }),
      ),
    ).rejects.toThrow();
    await expect(withTenant(T.tenantId, T.userId, (tx) => tx.saasInvoice.deleteMany({ where: { id: setup.id } }))).rejects.toThrow();
    await expect(
      withTenant(T.tenantId, T.userId, (tx) =>
        tx.tenantSubscription.update({ where: { tenantId: T.tenantId }, data: { status: "ACTIVE" } }),
      ),
    ).rejects.toThrow();
  });

  it("une facture émise est figée, même pour la plateforme", async () => {
    const [setup] = await invoices();
    await expect(platform((tx) => tx.saasInvoice.update({ where: { id: setup.id }, data: { amountXof: 1 } }))).rejects.toThrow();
  });

  it("tableau de bord : MRR et salles payantes", async () => {
    const kpi = await platform((tx) => platformDashboard(tx));
    expect(kpi.mrrXof).toBeGreaterThanOrEqual(30_000);
    expect(kpi.payingTenants).toBeGreaterThanOrEqual(1);
  });
});
