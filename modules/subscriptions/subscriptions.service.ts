import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { PaymentMethod, Prisma, SubscriptionStatus } from "@/lib/generated/prisma/client";
import { checkbox } from "@/lib/validation";
import {
  addDays,
  computeEndDate,
  computeUnfreeze,
  daysBetween,
  effectiveStatus,
  freezeAllowance,
  isoDate,
  overlaps,
  parseCalendarDate,
  renewalStartDate,
} from "@/modules/subscriptions/dates";

type Actor = { tenantId: string; userId: string };

/** Abonnements « vivants » : ni expirés en base, ni annulés. */
const LIVE: SubscriptionStatus[] = ["PENDING_PAYMENT", "ACTIVE", "FROZEN"];
const BACKDATE_LIMIT_DAYS = 7;

export const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"] as const;

// --- Schémas -----------------------------------------------------------------

const calendarDateField = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const date = parseCalendarDate(v);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Date invalide." });
      return z.NEVER;
    }
    return date;
  });

export const paymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS, { error: "Choisissez un moyen de paiement." }),
    providerRef: z
      .string()
      .trim()
      .max(80, "80 caractères maximum.")
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((p, ctx) => {
    if (p.method !== "CASH" && !p.providerRef) {
      ctx.addIssue({
        code: "custom",
        path: ["providerRef"],
        message: "Référence obligatoire hors espèces (n° de transaction ou de virement).",
      });
    }
  });

export const assignSchema = z.object({
  memberId: z.uuid(),
  planId: z.uuid({ error: "Choisissez une formule." }),
  startDate: calendarDateField,
  collectNow: checkbox,
});

export const extendSchema = z.object({
  subscriptionId: z.uuid(),
  days: z.coerce.number({ error: "Nombre de jours invalide." }).int().min(1, "1 jour minimum.").max(90, "90 jours maximum."),
  reason: z.string().trim().min(3, "Indiquez le motif (geste commercial, fermeture…).").max(200),
});

export const cancelSchema = z.object({
  subscriptionId: z.uuid(),
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation.").max(200),
});

// --- Lecture ---------------------------------------------------------------

export function getMemberSubscriptions(tx: Tx, memberId: string) {
  return tx.subscription.findMany({
    where: { memberId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: {
      plan: { select: { maxFreezeDays: true, maxEntries: true } },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, amountXof: true, method: true, providerRef: true, status: true, paidAt: true },
      },
    },
  });
}

export type MemberSubscription = Awaited<ReturnType<typeof getMemberSubscriptions>>[number];

function snapshot(s: { planName: string; priceXof: number; startDate: Date; endDate: Date; status: SubscriptionStatus }) {
  return {
    plan: s.planName,
    priceXof: s.priceXof,
    start: isoDate(s.startDate),
    end: isoDate(s.endDate),
    status: s.status,
  } satisfies Prisma.InputJsonObject;
}

async function loadSubscription(tx: Tx, id: string) {
  const sub = await tx.subscription.findUnique({ where: { id }, include: { plan: { select: { maxFreezeDays: true } } } });
  if (!sub) throw new BusinessError("Abonnement introuvable.");
  return sub;
}

/**
 * Décale les abonnements suivants (renouvellements anticipés) quand la fin
 * d'un abonnement est repoussée : aucun chevauchement, aucun jour perdu.
 */
async function shiftFollowing(tx: Tx, memberId: string, after: Date, days: number) {
  if (days <= 0) return;
  const following = await tx.subscription.findMany({
    where: { memberId, status: { in: ["ACTIVE", "PENDING_PAYMENT"] }, startDate: { gt: after } },
    orderBy: { startDate: "asc" },
  });
  for (const s of following) {
    await tx.subscription.update({
      where: { id: s.id },
      data: { startDate: addDays(s.startDate, days), endDate: addDays(s.endDate, days) },
    });
  }
}

// --- Cycle de vie ----------------------------------------------------------

/**
 * Attribue une formule. L'abonnement naît EN ATTENTE DE PAIEMENT : il ne
 * devient actif que par un encaissement confirmé (ou s'il est gratuit).
 * Sans date imposée, il démarre au lendemain de l'abonnement en cours.
 */
export async function assignSubscription(
  tx: Tx,
  actor: Actor,
  input: { memberId: string; planId: string; startDate: Date | null },
  today: Date,
) {
  const member = await tx.member.findUnique({ where: { id: input.memberId }, select: { status: true } });
  if (!member) throw new BusinessError("Adhérent introuvable.");
  if (member.status === "ARCHIVED") throw new BusinessError("Restaurez l'adhérent avant de lui attribuer une formule.");

  const plan = await tx.membershipPlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw new BusinessError("Cette formule n'est plus proposée.", "planId");

  const live = await tx.subscription.findMany({
    where: { memberId: input.memberId, status: { in: LIVE } },
    orderBy: { endDate: "desc" },
  });
  if (live.some((s) => s.status === "PENDING_PAYMENT")) {
    throw new BusinessError("Un abonnement attend déjà son paiement : encaissez-le ou annulez-le d'abord.");
  }
  const running = live.filter((s) => effectiveStatus(s, today) !== "EXPIRED");

  const startDate = input.startDate ?? renewalStartDate(running[0]?.endDate ?? null, today);
  if (daysBetween(startDate, today) > BACKDATE_LIMIT_DAYS) {
    throw new BusinessError(`La date de début ne peut pas remonter à plus de ${BACKDATE_LIMIT_DAYS} jours.`, "startDate");
  }
  const endDate = computeEndDate(startDate, plan.durationValue, plan.durationUnit);
  const clash = running.find((s) => overlaps(s, { startDate, endDate }));
  if (clash) {
    throw new BusinessError(
      `Chevauche l'abonnement « ${clash.planName} » (du ${formatDate(clash.startDate)} au ${formatDate(clash.endDate)}).`,
      "startDate",
    );
  }

  // Chaînage des renouvellements : on garde toujours l'historique.
  const previous = await tx.subscription.findFirst({
    where: { memberId: input.memberId, status: { not: "CANCELLED" } },
    orderBy: { endDate: "desc" },
    select: { id: true },
  });

  const sub = await tx.subscription.create({
    data: {
      tenantId: actor.tenantId,
      memberId: input.memberId,
      planId: plan.id,
      planName: plan.name,
      priceXof: plan.priceXof,
      durationValue: plan.durationValue,
      durationUnit: plan.durationUnit,
      startDate,
      endDate,
      previousId: previous?.id ?? null,
      createdById: actor.userId,
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: previous ? "subscription.renew" : "subscription.create",
    entityType: "subscription",
    entityId: sub.id,
    after: snapshot(sub),
  });

  if (plan.priceXof === 0) await activate(tx, actor, sub.id, "free");
  return sub;
}

async function activate(tx: Tx, actor: Actor, subscriptionId: string, reason: "payment" | "free") {
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "subscription.activate",
    entityType: "subscription",
    entityId: subscriptionId,
    after: { reason },
  });
}

/**
 * Encaissement à l'accueil du montant INTÉGRAL (le paiement partiel arrive
 * au Sprint 4). Seule voie d'activation d'un abonnement payant.
 */
export async function recordManualPayment(
  tx: Tx,
  actor: Actor,
  subscriptionId: string,
  input: { method: PaymentMethod; providerRef: string | null },
) {
  const sub = await loadSubscription(tx, subscriptionId);
  if (sub.status !== "PENDING_PAYMENT") throw new BusinessError("Cet abonnement n'attend pas de paiement.");

  if (input.providerRef) {
    const duplicate = await tx.payment.findFirst({
      where: { provider: "manual", providerRef: input.providerRef },
      select: { id: true },
    });
    if (duplicate) throw new BusinessError("Cette référence de transaction est déjà enregistrée.", "providerRef");
  }

  const payment = await tx.payment.create({
    data: {
      tenantId: actor.tenantId,
      memberId: sub.memberId,
      subscriptionId: sub.id,
      amountXof: sub.priceXof,
      method: input.method,
      providerRef: input.providerRef,
      status: "SUCCEEDED",
      collectedById: actor.userId,
      paidAt: new Date(),
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "payment.collect",
    entityType: "payment",
    entityId: payment.id,
    after: { subscriptionId: sub.id, amountXof: sub.priceXof, method: input.method, providerRef: input.providerRef },
  });
  await activate(tx, actor, sub.id, "payment");
  return payment;
}

export async function freezeSubscription(tx: Tx, actor: Actor, subscriptionId: string, today: Date) {
  const sub = await loadSubscription(tx, subscriptionId);
  if (effectiveStatus(sub, today) !== "ACTIVE") {
    throw new BusinessError("Seul un abonnement en cours peut être suspendu.");
  }
  if (freezeAllowance(sub.plan.maxFreezeDays, sub.frozenDays) === 0) {
    throw new BusinessError("Cette formule ne permet pas (ou plus) de suspension.");
  }
  await tx.subscription.update({ where: { id: sub.id }, data: { status: "FROZEN", frozenSince: today } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "subscription.freeze",
    entityType: "subscription",
    entityId: sub.id,
    after: { frozenSince: isoDate(today) },
  });
}

export async function unfreezeSubscription(tx: Tx, actor: Actor, subscriptionId: string, today: Date) {
  const sub = await loadSubscription(tx, subscriptionId);
  if (sub.status !== "FROZEN" || !sub.frozenSince) throw new BusinessError("Cet abonnement n'est pas suspendu.");

  const result = computeUnfreeze(
    { endDate: sub.endDate, frozenSince: sub.frozenSince, frozenDays: sub.frozenDays, maxFreezeDays: sub.plan.maxFreezeDays },
    today,
  );
  await tx.subscription.update({
    where: { id: sub.id },
    data: { status: "ACTIVE", endDate: result.newEndDate, frozenDays: result.frozenDays, frozenSince: null },
  });
  await shiftFollowing(tx, sub.memberId, sub.endDate, result.credited);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "subscription.unfreeze",
    entityType: "subscription",
    entityId: sub.id,
    before: { end: isoDate(sub.endDate) },
    after: { end: isoDate(result.newEndDate), credited: result.credited, overflow: result.overflow },
  });
  return result;
}

/** Prolongation exceptionnelle (geste commercial, fermeture de la salle…). */
export async function extendSubscription(
  tx: Tx,
  actor: Actor,
  input: { subscriptionId: string; days: number; reason: string },
  today: Date,
) {
  const sub = await loadSubscription(tx, input.subscriptionId);
  const status = effectiveStatus(sub, today);
  if (status !== "ACTIVE" && status !== "UPCOMING" && status !== "FROZEN") {
    throw new BusinessError("Seul un abonnement en cours, à venir ou suspendu peut être prolongé.");
  }
  const newEnd = addDays(sub.endDate, input.days);
  await tx.subscription.update({ where: { id: sub.id }, data: { endDate: newEnd } });
  await shiftFollowing(tx, sub.memberId, sub.endDate, input.days);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "subscription.extend",
    entityType: "subscription",
    entityId: sub.id,
    before: { end: isoDate(sub.endDate) },
    after: { end: isoDate(newEnd), days: input.days, reason: input.reason },
  });
}

/**
 * Annulation. Un abonnement déjà PAYÉ ne s'annule que par un gérant ou un
 * administrateur ; le remboursement éventuel sera géré au Sprint 4.
 */
export async function cancelSubscription(
  tx: Tx,
  actor: Actor,
  input: { subscriptionId: string; reason: string },
  options: { canCancelPaid: boolean },
) {
  const sub = await loadSubscription(tx, input.subscriptionId);
  if (!LIVE.includes(sub.status)) throw new BusinessError("Cet abonnement ne peut plus être annulé.");
  const paid = sub.status !== "PENDING_PAYMENT" && sub.priceXof > 0;
  if (paid && !options.canCancelPaid) {
    throw new BusinessError("Seul un gérant ou un administrateur peut annuler un abonnement déjà payé.");
  }
  await tx.subscription.update({
    where: { id: sub.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason, frozenSince: null },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "subscription.cancel",
    entityType: "subscription",
    entityId: sub.id,
    before: snapshot(sub),
    after: { reason: input.reason, paid },
  });
  return { paid };
}

// --- Listes et indicateurs -----------------------------------------------

export const REPORTS = {
  "a-renouveler": "À renouveler (7 jours)",
  expires: "Expirés (30 derniers jours)",
  "en-attente": "En attente de paiement",
  "en-cours": "En cours",
} as const;
export type ReportKind = keyof typeof REPORTS;

export function parseReport(value: unknown): ReportKind {
  return typeof value === "string" && value in REPORTS ? (value as ReportKind) : "a-renouveler";
}

/** « Non renouvelé » = aucun abonnement suivant vivant dans la chaîne. */
const notRenewed: Prisma.SubscriptionWhereInput = { renewals: { none: { status: { in: LIVE } } } };

export function reportWhere(kind: ReportKind, today: Date): Prisma.SubscriptionWhereInput {
  switch (kind) {
    case "a-renouveler":
      return { status: "ACTIVE", endDate: { gte: today, lte: addDays(today, 7) }, ...notRenewed };
    case "expires":
      return {
        OR: [{ status: "ACTIVE", endDate: { lt: today } }, { status: "EXPIRED" }],
        endDate: { gte: addDays(today, -30) },
        ...notRenewed,
      };
    case "en-attente":
      return { status: "PENDING_PAYMENT" };
    case "en-cours":
      return { OR: [{ status: "ACTIVE", startDate: { lte: today }, endDate: { gte: today } }, { status: "FROZEN" }] };
  }
}

export function subscriptionReport(tx: Tx, kind: ReportKind, today: Date) {
  return tx.subscription.findMany({
    where: reportWhere(kind, today),
    orderBy: kind === "en-attente" ? { createdAt: "desc" } : { endDate: "asc" },
    take: 200,
    include: { member: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } } },
  });
}

/** Indicateurs du tableau de bord — paiements CONFIRMÉS uniquement. */
export async function dashboardStats(tx: Tx, today: Date) {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [inProgress, toRenew, expired, pending, members, month, day] = await Promise.all([
    tx.subscription.findMany({ where: reportWhere("en-cours", today), select: { memberId: true }, distinct: ["memberId"] }),
    tx.subscription.count({ where: reportWhere("a-renouveler", today) }),
    tx.subscription.count({ where: reportWhere("expires", today) }),
    tx.subscription.count({ where: reportWhere("en-attente", today) }),
    tx.member.count({ where: { status: { not: "ARCHIVED" } } }),
    tx.payment.aggregate({ where: { status: "SUCCEEDED", paidAt: { gte: monthStart } }, _sum: { amountXof: true } }),
    tx.payment.aggregate({ where: { status: "SUCCEEDED", paidAt: { gte: today } }, _sum: { amountXof: true } }),
  ]);
  return {
    activeMembers: inProgress.length,
    members,
    toRenew,
    expired,
    pending,
    revenueMonth: month._sum.amountXof ?? 0,
    revenueToday: day._sum.amountXof ?? 0,
  };
}
