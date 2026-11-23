/**
 * Sprint 10 — Dépenses et caisse, contre PostgreSQL (RLS actif, rôle applicatif).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import { renderCashReportPdf } from "@/modules/cash/cash-report-pdf";
import {
  addManualMovement,
  cashSessionReport,
  closeCashSession,
  currentCashView,
  openCashSession,
  validateCashSession,
} from "@/modules/cash/cash.service";
import {
  addAttachment,
  createExpense,
  expenseSchema,
  listCategories,
  listExpenses,
  safeFileName,
  sniffMimeType,
  voidExpense,
} from "@/modules/expenses/expenses.service";
import { createMember } from "@/modules/members/members.service";
import { refundPayment } from "@/modules/payments/payments.service";
import { createPlan } from "@/modules/plans/plans.service";
import { parseCalendarDate, todayCalendar } from "@/modules/subscriptions/dates";
import { assignSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `cash-mgr-${run}` }; // gérant : ouvre et clôture
const ADMIN = { tenantId: A.tenantId, userId: `cash-adm-${run}` }; // valide
const B = { tenantId: randomUUID(), userId: `cash-b-${run}` };
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const TODAY = todayCalendar();
let planId = "";
let seq = 0;

async function sale(method: "CASH" | "MOBILE_MONEY" = "CASH") {
  seq++;
  return inA(async (tx) => {
    const member = await createMember(tx, A, {
      firstName: "Caisse",
      lastName: `C${seq}`,
      phone: `+225015555${String(1000 + seq)}`,
      email: null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    });
    const sub = await assignSubscription(tx, A, { memberId: member.id, planId, startDate: null }, TODAY);
    return recordManualPayment(tx, A, sub.id, { method, providerRef: method === "CASH" ? null : `MM-${run}-${seq}` });
  });
}

const expenseInput = async (amount: number, method: "CASH" | "MOBILE_MONEY" = "CASH") => {
  const categories = await inA((tx) => listCategories(tx, A.tenantId));
  return expenseSchema.parse({
    categoryId: categories[0].id,
    label: `Achat ${amount}`,
    amountXof: String(amount),
    spentOn: TODAY.toISOString().slice(0, 10),
    method,
  });
};

beforeAll(async () => {
  await owner.user.createMany({
    data: [A, ADMIN, B].map((u) => ({ id: u.userId, name: u.userId, email: `${u.userId}@test.local` })),
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `cash-a-${run}`, name: "Caisse A" },
      { id: B.tenantId, slug: `cash-b-${run}`, name: "Caisse B" },
    ],
  });
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: A.tenantId, userId: A.userId, role: "MANAGER" },
      { tenantId: A.tenantId, userId: ADMIN.userId, role: "ADMIN" },
      { tenantId: B.tenantId, userId: B.userId, role: "ADMIN" },
    ],
  });
  planId = (
    await inA((tx) =>
      createPlan(tx, A, {
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
    )
  ).id;
});

afterAll(async () => {
  for (const tenantId of [A.tenantId, B.tenantId]) {
    const where = { tenantId };
    await owner.cashMovement.deleteMany({ where });
    await owner.cashSession.deleteMany({ where });
    await owner.expenseAttachment.deleteMany({ where });
    await owner.expense.deleteMany({ where });
    await owner.expenseCategory.deleteMany({ where });
    await owner.notification.deleteMany({ where });
    await owner.receipt.deleteMany({ where });
    await owner.payment.deleteMany({ where: { ...where, kind: "REFUND" } });
    await owner.payment.deleteMany({ where });
    await owner.subscription.updateMany({ where, data: { previousId: null } });
    await owner.subscription.deleteMany({ where });
    await owner.member.deleteMany({ where });
    await owner.membershipPlan.deleteMany({ where });
    await owner.auditLog.deleteMany({ where });
    await owner.tenantMembership.deleteMany({ where });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.user.deleteMany({ where: { id: { in: [A.userId, ADMIN.userId, B.userId] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Espèces sans caisse ouverte", () => {
  it("mode souple : encaissement journalisé « hors caisse »", async () => {
    const { payment } = await sale();
    const movement = await owner.cashMovement.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(movement).toMatchObject({ kind: "PAYMENT", amountXof: 20_000, sessionId: null });
  });

  it("caisse obligatoire : encaissement refusé et entièrement annulé", async () => {
    await owner.tenant.update({ where: { id: A.tenantId }, data: { cashSessionRequired: true } });
    const before = await owner.payment.count({ where: { tenantId: A.tenantId } });
    await expect(sale()).rejects.toThrow(/Ouvrez la caisse/);
    expect(await owner.payment.count({ where: { tenantId: A.tenantId } })).toBe(before);
    // Le Mobile Money n'est pas concerné
    await expect(sale("MOBILE_MONEY")).resolves.toBeDefined();
    await owner.tenant.update({ where: { id: A.tenantId }, data: { cashSessionRequired: false } });
  });
});

describe("Journée de caisse", () => {
  let firstSessionId = "";
  let cashExpenseId = "";

  it("ouverture, encaissements, remboursement, dépense, apport et retrait", async () => {
    await inA((tx) => openCashSession(tx, A, { openingFloatXof: 10_000 }));
    await expect(inA((tx) => openCashSession(tx, A, { openingFloatXof: 0 }))).rejects.toThrow(/déjà ouverte/);

    const { payment } = await sale(); // +20 000
    await sale("MOBILE_MONEY"); // aucun mouvement d'espèces
    await inA((tx) => refundPayment(tx, A, { paymentId: payment.id, amountXof: 5_000, reason: "Geste commercial" })); // −5 000
    cashExpenseId = (await inA(async (tx) => createExpense(tx, A, await expenseInput(3_000)))).id; // −3 000
    await inA(async (tx) => createExpense(tx, A, await expenseInput(50_000, "MOBILE_MONEY"))); // hors caisse
    await inA((tx) => addManualMovement(tx, A, { kind: "DEPOSIT", amountXof: 2_000, label: "Monnaie" })); // +2 000
    await inA((tx) => addManualMovement(tx, A, { kind: "WITHDRAWAL", amountXof: 4_000, label: "Remise en banque" })); // −4 000

    const view = await inA((tx) => currentCashView(tx));
    firstSessionId = view!.session.id;
    expect(view!.balance).toBe(10_000 + 20_000 - 5_000 - 3_000 + 2_000 - 4_000);
    expect(view!.movements.map((m) => m.kind).sort()).toEqual(
      ["DEPOSIT", "EXPENSE", "PAYMENT", "REFUND", "WITHDRAWAL"].sort(),
    );
  });

  it("une sortie supérieure au contenu de la caisse est refusée (dépense non créée)", async () => {
    const before = await owner.expense.count({ where: { tenantId: A.tenantId } });
    await expect(inA(async (tx) => createExpense(tx, A, await expenseInput(1_000_000)))).rejects.toThrow(/ne contient que/);
    await expect(
      inA((tx) => addManualMovement(tx, A, { kind: "WITHDRAWAL", amountXof: 1_000_000, label: "Trop" })),
    ).rejects.toThrow(/ne contient que/);
    expect(await owner.expense.count({ where: { tenantId: A.tenantId } })).toBe(before);
  });

  it("la base refuse un théorique de clôture falsifié", async () => {
    await expect(
      inA((tx) =>
        tx.cashSession.update({
          where: { id: firstSessionId },
          data: { status: "CLOSED", closedById: A.userId, closedAt: new Date(), expectedXof: 1, countedXof: 1, differenceXof: 0 },
        }),
      ),
    ).rejects.toThrow();
  });

  it("clôture : un écart doit être expliqué", async () => {
    await expect(inA((tx) => closeCashSession(tx, A, { countedXof: 19_500, closingNote: null }))).rejects.toThrow(
      /Écart de -500/,
    );
    const closed = await inA((tx) => closeCashSession(tx, A, { countedXof: 19_500, closingNote: "Pièce de 500 introuvable" }));
    expect(closed).toMatchObject({ status: "CLOSED", expectedXof: 20_000, countedXof: 19_500, differenceXof: -500 });
  });

  it("plus aucun mouvement dans une caisse clôturée (garanti par la base)", async () => {
    await expect(
      inA((tx) =>
        tx.cashMovement.create({
          data: { tenantId: A.tenantId, sessionId: firstSessionId, kind: "DEPOSIT", amountXof: 100, label: "Fraude" },
        }),
      ),
    ).rejects.toThrow();
    // et le rôle applicatif ne peut ni modifier ni supprimer un mouvement
    await expect(inA((tx) => tx.cashMovement.deleteMany({ where: { sessionId: firstSessionId } }))).rejects.toThrow();
    await expect(
      inA((tx) => tx.cashMovement.updateMany({ where: { sessionId: firstSessionId }, data: { amountXof: 1 } })),
    ).rejects.toThrow();
  });

  it("validation : pas par celui qui a clôturé ; écart commenté ; ensuite figée", async () => {
    await expect(
      inA((tx) => validateCashSession(tx, A, "MANAGER", { sessionId: firstSessionId, validationNote: "OK" })),
    ).rejects.toThrow(/un autre responsable/);
    await expect(
      inA((tx) => validateCashSession(tx, ADMIN, "ADMIN", { sessionId: firstSessionId, validationNote: null })),
    ).rejects.toThrow(/indiquez la suite/);
    const validated = await inA((tx) =>
      validateCashSession(tx, ADMIN, "ADMIN", { sessionId: firstSessionId, validationNote: "Retenue de 500 FCFA" }),
    );
    expect(validated.status).toBe("VALIDATED");

    // Z de caisse : PDF valide, avec la synthèse
    const report = await inA((tx) => cashSessionReport(tx, firstSessionId));
    const pdf = await renderCashReportPdf(report!, "Caisse A");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(report!.byKind.map((k) => k.kind).sort()).toEqual(["DEPOSIT", "EXPENSE", "PAYMENT", "REFUND", "WITHDRAWAL"]);
    await expect(
      inA((tx) => tx.cashSession.update({ where: { id: firstSessionId }, data: { validationNote: "modifié" } })),
    ).rejects.toThrow();
  });

  it("annuler une dépense en espèces : contre-passation dans la caisse OUVERTE", async () => {
    await inA((tx) => openCashSession(tx, A, { openingFloatXof: 19_500 }));
    await inA((tx) => voidExpense(tx, A, { expenseId: cashExpenseId, reason: "Doublon" }));
    await expect(inA((tx) => voidExpense(tx, A, { expenseId: cashExpenseId, reason: "Encore" }))).rejects.toThrow(
      /déjà annulée/,
    );
    const view = await inA((tx) => currentCashView(tx));
    expect(view!.movements.map((m) => [m.kind, m.amountXof])).toEqual([["EXPENSE_VOID", 3_000]]);
    expect(view!.balance).toBe(22_500);
    // la caisse d'origine est intacte
    const original = await owner.cashMovement.findFirstOrThrow({ where: { expenseId: cashExpenseId, kind: "EXPENSE" } });
    expect(original.sessionId).toBe(firstSessionId);
    await inA((tx) => closeCashSession(tx, A, { countedXof: 22_500, closingNote: null }));
  });
});

describe("Dépenses", () => {
  it("catégories par défaut, totaux sans les dépenses annulées", async () => {
    const from = TODAY;
    const to = new Date(TODAY.getTime() + 86_400_000);
    const { rows, totals } = await inA((tx) => listExpenses(tx, { from, to }));
    expect(rows.some((r) => r.status === "VOIDED")).toBe(true);
    expect(totals.total).toBe(50_000); // la dépense en espèces annulée n'est pas comptée
  });

  it("date future refusée", async () => {
    const input = await expenseInput(1_000, "MOBILE_MONEY");
    const tomorrow = parseCalendarDate(new Date(TODAY.getTime() + 86_400_000).toISOString().slice(0, 10))!;
    await expect(inA((tx) => createExpense(tx, A, { ...input, spentOn: tomorrow }))).rejects.toThrow(/futur/);
  });

  it("justificatifs : type réel vérifié, taille bornée, nom nettoyé", async () => {
    const expense = await inA(async (tx) => createExpense(tx, A, await expenseInput(7_000, "MOBILE_MONEY")));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const added = await inA((tx) => addAttachment(tx, A, expense.id, { name: "C:\\factures\\loyer.png", bytes: png }));
    expect(added.fileName).toBe("loyer.png");

    const fakePdf = new TextEncoder().encode("<script>alert(1)</script>");
    await expect(inA((tx) => addAttachment(tx, A, expense.id, { name: "facture.pdf", bytes: fakePdf }))).rejects.toThrow(
      /Formats acceptés/,
    );
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(inA((tx) => addAttachment(tx, A, expense.id, { name: "gros.pdf", bytes: big }))).rejects.toThrow(/5 Mo/);

    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(safeFileName('../../etc/"passwd"')).toBe("passwd");
  });

  it("isolation : une autre salle ne voit ni dépenses, ni caisse, ni justificatifs", async () => {
    const seen = await withTenant(B.tenantId, B.userId, async (tx) => ({
      expenses: await tx.expense.count(),
      sessions: await tx.cashSession.count(),
      movements: await tx.cashMovement.count(),
      attachments: await tx.expenseAttachment.count(),
    }));
    expect(seen).toEqual({ expenses: 0, sessions: 0, movements: 0, attachments: 0 });
  });
});
