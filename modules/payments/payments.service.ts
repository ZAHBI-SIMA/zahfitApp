import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatXof } from "@/lib/format";
import type { PaymentKind, Prisma } from "@/lib/generated/prisma/client";
import { checkbox, optionalText } from "@/lib/validation";
import { addDays } from "@/modules/subscriptions/dates";

type Actor = { tenantId: string; userId: string | null };

// --- Montants ----------------------------------------------------------------

/** « 20 000 » ou « 20000 FCFA » → 20000 ; vide → undefined (montant par défaut). */
export const optionalAmountField = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? Number(v.replace(/[^\d]/g, "")) : undefined))
  .refine((n) => n === undefined || (Number.isInteger(n) && n > 0 && n <= 10_000_000), "Montant invalide.");

/**
 * Seuil d'activation : prix complet, ou acompte minimum si la salle
 * autorise le paiement en plusieurs fois.
 */
export function activationThreshold(priceXof: number, settings: { allowPartialPayment: boolean; minDepositPercent: number }) {
  return settings.allowPartialPayment ? Math.ceil((priceXof * settings.minDepositPercent) / 100) : priceXof;
}

/** Net encaissé sur un abonnement : paiements − remboursements confirmés. */
export async function netPaid(tx: Tx, subscriptionId: string, until?: Date): Promise<number> {
  const rows = await tx.payment.groupBy({
    by: ["kind"],
    where: { subscriptionId, status: "SUCCEEDED", ...(until ? { createdAt: { lte: until } } : {}) },
    _sum: { amountXof: true },
  });
  const sum = (kind: PaymentKind) => rows.find((r) => r.kind === kind)?._sum.amountXof ?? 0;
  return sum("PAYMENT") - sum("REFUND");
}

/** Verrouille une ligne jusqu'à la fin de la transaction (encaissements simultanés). */
export async function lockRow(tx: Tx, table: "payments" | "subscriptions" | "members", id: string) {
  // Noms de table en dur (jamais interpolés) : aucune injection possible.
  if (table === "payments") await tx.$executeRaw`SELECT 1 FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
  else if (table === "subscriptions") await tx.$executeRaw`SELECT 1 FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
  else await tx.$executeRaw`SELECT 1 FROM members WHERE id = ${id}::uuid FOR UPDATE`;
}

// --- Reçus -------------------------------------------------------------------

export const receiptNumber = (seq: number, kind: PaymentKind) =>
  `${kind === "REFUND" ? "AV" : "REC"}-${String(seq).padStart(6, "0")}`;

/**
 * Émet le reçu (ou l'avoir) d'une transaction confirmée. Le compteur de la
 * salle est incrémenté DANS la transaction : si l'encaissement échoue, le
 * numéro n'est pas consommé — la numérotation reste continue.
 */
export async function issueReceipt(tx: Tx, tenantId: string, payment: { id: string; kind: PaymentKind }) {
  const { receiptSeq } = await tx.tenant.update({
    where: { id: tenantId },
    data: { receiptSeq: { increment: 1 } },
    select: { receiptSeq: true },
  });
  return tx.receipt.create({
    data: { tenantId, paymentId: payment.id, number: receiptNumber(receiptSeq, payment.kind) },
  });
}

/** Tout ce qu'il faut pour imprimer un reçu (et vérifier qui peut le voir). */
export async function loadReceipt(tx: Tx, receiptId: string) {
  const receipt = await tx.receipt.findUnique({
    where: { id: receiptId },
    include: {
      tenant: { select: { name: true, address: true, commune: true, city: true, phone: true, email: true, receiptFooter: true } },
      payment: {
        include: {
          member: { select: { code: true, firstName: true, lastName: true, phone: true, email: true, userId: true } },
          subscription: { select: { id: true, planName: true, priceXof: true, startDate: true, endDate: true } },
          refundOf: { select: { receipt: { select: { number: true } } } },
        },
      },
    },
  });
  if (!receipt) return null;
  const { payment } = receipt;
  const cashier = payment.collectedById
    ? await tx.user.findUnique({ where: { id: payment.collectedById }, select: { name: true } })
    : null;
  // Montant payé À LA DATE du reçu : réimprimer un ancien reçu donne toujours le même document.
  const paidAtThatTime = payment.subscription ? await netPaid(tx, payment.subscription.id, payment.createdAt) : null;
  return { receipt, payment, cashierName: cashier?.name ?? null, paidAtThatTime };
}

export type LoadedReceipt = NonNullable<Awaited<ReturnType<typeof loadReceipt>>>;

// --- Remboursements ------------------------------------------------------

export const refundSchema = z.object({
  paymentId: z.uuid(),
  amountXof: optionalAmountField,
  reason: z.string().trim().min(3, "Indiquez le motif du remboursement.").max(200),
  cancelSubscription: checkbox,
});

/**
 * Remboursement total ou partiel d'un paiement. Crée une transaction
 * REFUND et un AVOIR numéroté ; le paiement d'origine reste intact.
 */
export async function refundPayment(
  tx: Tx,
  actor: Actor,
  input: { paymentId: string; amountXof?: number; reason: string },
) {
  await lockRow(tx, "payments", input.paymentId); // deux remboursements simultanés ne peuvent pas dépasser le montant
  const original = await tx.payment.findUnique({
    where: { id: input.paymentId },
    include: { refunds: { where: { status: "SUCCEEDED" }, select: { amountXof: true } } },
  });
  if (!original || original.kind !== "PAYMENT" || original.status !== "SUCCEEDED") {
    throw new BusinessError("Ce paiement ne peut pas être remboursé.");
  }
  const refundable = original.amountXof - original.refunds.reduce((s, r) => s + r.amountXof, 0);
  const amount = input.amountXof ?? refundable;
  if (refundable <= 0) throw new BusinessError("Ce paiement a déjà été entièrement remboursé.");
  if (amount > refundable) {
    throw new BusinessError(`Montant remboursable : ${formatXof(refundable)} au maximum.`, "amountXof");
  }

  const refund = await tx.payment.create({
    data: {
      tenantId: actor.tenantId,
      memberId: original.memberId,
      subscriptionId: original.subscriptionId,
      kind: "REFUND",
      refundOfId: original.id,
      reason: input.reason,
      amountXof: amount,
      method: original.method,
      status: "SUCCEEDED",
      collectedById: actor.userId,
      paidAt: new Date(),
    },
  });
  const receipt = await issueReceipt(tx, actor.tenantId, refund);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "payment.refund",
    entityType: "payment",
    entityId: refund.id,
    after: { refundOf: original.id, amountXof: amount, reason: input.reason, receipt: receipt.number },
  });
  return { refund, receipt };
}

// --- Paramètres d'encaissement ----------------------------------------------

export const billingSettingsSchema = z.object({
  allowPartialPayment: checkbox,
  minDepositPercent: z.coerce
    .number({ error: "Pourcentage invalide." })
    .int()
    .min(10, "10 % minimum.")
    .max(100, "100 % maximum."),
  receiptFooter: optionalText(300),
});

export async function updateBillingSettings(tx: Tx, actor: Actor, input: z.infer<typeof billingSettingsSchema>) {
  await tx.tenant.update({ where: { id: actor.tenantId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "billing.settings.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: { allowPartialPayment: input.allowPartialPayment, minDepositPercent: input.minDepositPercent },
  });
}

// --- Journal des paiements et export -------------------------------------

export const PERIODS = {
  jour: "Aujourd'hui",
  "7j": "7 derniers jours",
  mois: "Ce mois-ci",
  "mois-precedent": "Mois précédent",
} as const;
export type Period = keyof typeof PERIODS;

export function parsePeriod(value: unknown): Period {
  return typeof value === "string" && value in PERIODS ? (value as Period) : "jour";
}

/** Bornes [from, to[ d'une période, en dates calendaires (Africa/Abidjan = UTC). */
export function periodRange(period: Period, today: Date): { from: Date; to: Date } {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  switch (period) {
    case "jour":
      return { from: today, to: addDays(today, 1) };
    case "7j":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "mois":
      return { from: monthStart, to: addDays(today, 1) };
    case "mois-precedent":
      return { from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), to: monthStart };
  }
}

export async function listPayments(tx: Tx, range: { from: Date; to: Date }) {
  const where: Prisma.PaymentWhereInput = { status: "SUCCEEDED", paidAt: { gte: range.from, lt: range.to } };
  const payments = await tx.payment.findMany({
    where,
    orderBy: { paidAt: "desc" },
    take: 1000,
    include: {
      member: { select: { id: true, code: true, firstName: true, lastName: true } },
      subscription: { select: { planName: true } },
      receipt: { select: { id: true, number: true } },
    },
  });
  const cashierIds = [...new Set(payments.map((p) => p.collectedById).filter((id): id is string => !!id))];
  const cashiers = await tx.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } });
  const names = new Map(cashiers.map((c) => [c.id, c.name]));

  const signed = (p: { kind: PaymentKind; amountXof: number }) => (p.kind === "REFUND" ? -p.amountXof : p.amountXof);
  const byMethod = new Map<string, number>();
  for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + signed(p));

  return {
    rows: payments.map((p) => ({
      ...p,
      signedAmount: signed(p),
      cashierName: p.collectedById ? (names.get(p.collectedById) ?? "—") : "—",
    })),
    totals: {
      collected: payments.filter((p) => p.kind === "PAYMENT").reduce((s, p) => s + p.amountXof, 0),
      refunded: payments.filter((p) => p.kind === "REFUND").reduce((s, p) => s + p.amountXof, 0),
      net: payments.reduce((s, p) => s + signed(p), 0),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
    },
  };
}
