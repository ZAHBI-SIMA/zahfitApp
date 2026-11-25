import * as z from "zod";
import { audit } from "@/lib/audit";
import { withDbContext, type Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatDate, formatXof } from "@/lib/format";
import type { SaasInvoiceKind, SaasSubscriptionStatus } from "@/lib/generated/prisma/enums";
import { sendMail } from "@/lib/mail";
import { optionalText, requiredText } from "@/lib/validation";
import { BILLING_RULES, invoiceNumber, overdueStatus, reminderDue } from "@/modules/billing/billing.rules";
import type { PaymentProvider } from "@/modules/payments/providers";
import { addDays, computeEndDate, daysBetween, todayCalendar } from "@/modules/subscriptions/dates";

/**
 * Facturation ZahDigit → salles : essai, factures d'installation et
 * mensuelles (d'avance), paiement Mobile Money par la salle, relances,
 * retard → lecture seule → suspension, réactivation au paiement.
 *
 * Toutes les écritures se font en contexte PLATEFORME (tâche planifiée,
 * webhook, Super Admin) ; la salle ne peut que lire et lancer un paiement.
 */

const platform = <T>(fn: (tx: Tx) => Promise<T>) => withDbContext({ platform: true }, fn);
type Plan = { code: string; name: string; monthlyPriceXof: number; setupFeeXof: number };
type Mail = Parameters<typeof sendMail>[0];

// --- Factures -----------------------------------------------------------------------

/** Numéro suivant, incrémenté sous verrou dans la transaction : aucun trou. */
async function nextInvoiceNumber(tx: Tx) {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    UPDATE platform_counters SET value = value + 1 WHERE key = 'saas_invoice' RETURNING value`;
  if (!row) throw new Error("Compteur de factures absent (migration 20270107080100).");
  return invoiceNumber(row.value);
}

async function issueInvoice(
  tx: Tx,
  input: { tenantId: string; kind: SaasInvoiceKind; plan: Plan; today: Date; periodStart?: Date; periodEnd?: Date },
) {
  const amount = input.kind === "SETUP" ? input.plan.setupFeeXof : input.plan.monthlyPriceXof;
  if (amount <= 0) return null; // forfait gratuit ou installation offerte : rien à facturer
  const invoice = await tx.saasInvoice.create({
    data: {
      tenantId: input.tenantId,
      number: await nextInvoiceNumber(tx),
      kind: input.kind,
      planCode: input.plan.code,
      planName: input.plan.name,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amountXof: amount,
      issuedOn: input.today,
      dueOn: addDays(input.today, BILLING_RULES.paymentTermsDays),
    },
  });
  await audit(tx, {
    tenantId: input.tenantId,
    action: "saas_invoice.issue",
    entityType: "saas_invoice",
    entityId: invoice.id,
    after: { number: invoice.number, kind: input.kind, amountXof: amount },
  });
  return invoice;
}

async function loadPlan(tx: Tx, tenantId: string): Promise<Plan> {
  const { saasPlan } = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { saasPlan: { select: { code: true, name: true, monthlyPriceXof: true, setupFeeXof: true } } },
  });
  return saasPlan;
}

const monthlyPeriod = (start: Date) => ({ start, end: computeEndDate(start, 1, "MONTH") });

/** Ouverture de la facturation d'une nouvelle salle : essai + facture d'installation. CONTEXTE PLATEFORME. */
export async function startTenantBilling(tx: Tx, actorId: string | null, tenantId: string, today = todayCalendar()) {
  const plan = await loadPlan(tx, tenantId);
  const subscription = await tx.tenantSubscription.create({
    data: { tenantId, status: "TRIALING", trialEndsOn: addDays(today, BILLING_RULES.trialDays) },
  });
  await issueInvoice(tx, { tenantId, kind: "SETUP", plan, today });
  await audit(tx, {
    tenantId,
    actorUserId: actorId,
    action: "billing.start",
    entityType: "tenant_subscription",
    entityId: subscription.id,
    after: { plan: plan.code, trialEndsOn: subscription.trialEndsOn?.toISOString().slice(0, 10) ?? null },
  });
  return subscription;
}

// --- Statut selon le retard ---------------------------------------------------------

/**
 * Recalcule le statut d'après la plus ancienne facture impayée. Sortie de
 * suspension (paiement) : la salle est réactivée et une nouvelle période
 * commence le jour même (les mois suspendus ne sont pas facturés).
 */
export async function refreshBillingStatus(tx: Tx, tenantId: string, today: Date, actorId: string | null = null) {
  const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
  if (!sub || sub.status === "CANCELLED") return sub?.status ?? null;
  const oldest = await tx.saasInvoice.findFirst({
    where: { tenantId, status: "OPEN" },
    orderBy: { dueOn: "asc" },
    select: { number: true, dueOn: true },
  });
  const late = oldest ? overdueStatus(daysBetween(oldest.dueOn, today)) : null;
  const base: SaasSubscriptionStatus = sub.currentPeriodStart ? "ACTIVE" : "TRIALING";
  const target = late ?? base;
  if (target === sub.status) return target;

  if (target === "SUSPENDED") {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        status: "SUSPENDED",
        suspendedReason: `Facture ${oldest!.number} impayée (échéance ${formatDate(oldest!.dueOn)}).`,
      },
    });
  } else if (sub.status === "SUSPENDED") {
    // Suspension due à l'impayé (et non une suspension manuelle) : levée au règlement.
    await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", suspendedReason: null } });
  }
  const restart = sub.status === "SUSPENDED" && !late && base === "ACTIVE";
  const period = restart ? monthlyPeriod(today) : null;
  await tx.tenantSubscription.update({
    where: { id: sub.id },
    data: {
      status: target,
      statusChangedAt: new Date(),
      ...(period ? { currentPeriodStart: period.start, currentPeriodEnd: period.end } : {}),
    },
  });
  if (period) {
    const plan = await loadPlan(tx, tenantId);
    await issueInvoice(tx, { tenantId, kind: "MONTHLY", plan, today, periodStart: period.start, periodEnd: period.end });
  }
  await audit(tx, {
    tenantId,
    actorUserId: actorId,
    action: "billing.status",
    entityType: "tenant_subscription",
    entityId: sub.id,
    before: { status: sub.status },
    after: { status: target, invoice: oldest?.number ?? null },
  });
  return target;
}

// --- Cycle quotidien ----------------------------------------------------------------

async function adminEmails(tx: Tx, tenantId: string) {
  const admins = await tx.tenantMembership.findMany({
    where: { tenantId, role: "ADMIN", status: "ACTIVE" },
    select: { user: { select: { email: true } } },
  });
  return admins.map((a) => a.user.email);
}

function reminderMail(
  to: string,
  tenantName: string,
  invoice: { number: string; amountXof: number; dueOn: Date },
  key: string,
): Mail {
  const late = key.startsWith("J+");
  const subject = late
    ? `ZAHFIT — Facture ${invoice.number} en retard`
    : `ZAHFIT — Facture ${invoice.number} à régler avant le ${formatDate(invoice.dueOn)}`;
  const consequences =
    key === `J+${BILLING_RULES.suspendAfterDays}`
      ? "L'accès de votre salle est suspendu jusqu'au règlement (vos données sont conservées)."
      : key === `J+${BILLING_RULES.readOnlyAfterDays}`
        ? `Votre espace est passé en lecture seule. Sans règlement, il sera suspendu ${
            BILLING_RULES.suspendAfterDays - BILLING_RULES.readOnlyAfterDays
          } jours plus tard.`
        : late
          ? `Sans règlement, votre espace passera en lecture seule ${BILLING_RULES.readOnlyAfterDays} jours après l'échéance.`
          : "Vous pouvez la régler en Mobile Money depuis Administration → Abonnement ZAHFIT.";
  const text =
    `Bonjour, la facture ${invoice.number} de ${formatXof(invoice.amountXof)} pour ${tenantName} est ` +
    `${late ? "échue depuis le" : "à régler avant le"} ${formatDate(invoice.dueOn)}. ${consequences}`;
  return { to, subject, text, html: `<p>${text}</p>` };
}

/**
 * Tâche planifiée quotidienne : fin des essais, factures mensuelles,
 * expiration des paiements abandonnés, statuts de retard et relances. Les
 * e-mails partent APRÈS la transaction de chaque salle.
 */
export async function runBillingCycle(today = todayCalendar(), now = new Date()) {
  const summary = { tenants: 0, invoices: 0, reminders: 0, statusChanges: 0, expiredPayments: 0 };
  summary.expiredPayments = await platform(
    async (tx) =>
      (await tx.saasPayment.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } }))
        .count,
  );
  const subs = await platform((tx) =>
    tx.tenantSubscription.findMany({ where: { status: { not: "CANCELLED" } }, select: { tenantId: true } }),
  );
  for (const { tenantId } of subs) {
    summary.tenants++;
    const mails = await platform(async (tx) => {
      const out: Mail[] = [];
      const plan = await loadPlan(tx, tenantId);
      const sub = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

      // 1. Fin d'essai : première période, facturée d'avance.
      if (sub.status === "TRIALING" && sub.trialEndsOn && sub.trialEndsOn < today) {
        const p = monthlyPeriod(addDays(sub.trialEndsOn, 1));
        await tx.tenantSubscription.update({
          where: { id: sub.id },
          data: { status: "ACTIVE", statusChangedAt: now, currentPeriodStart: p.start, currentPeriodEnd: p.end },
        });
        if (await issueInvoice(tx, { tenantId, kind: "MONTHLY", plan, today, periodStart: p.start, periodEnd: p.end })) {
          summary.invoices++;
        }
        summary.statusChanges++;
      }

      // 2. Périodes échues (rattrapage si la tâche n'a pas tourné) ; rien pendant une suspension.
      const fresh = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      if (["ACTIVE", "PAST_DUE", "READ_ONLY"].includes(fresh.status) && fresh.currentPeriodStart && fresh.currentPeriodEnd) {
        let start = fresh.currentPeriodStart;
        let end = fresh.currentPeriodEnd;
        while (end < today) {
          const p = monthlyPeriod(addDays(end, 1));
          const exists = await tx.saasInvoice.findFirst({
            where: { tenantId, kind: "MONTHLY", periodStart: p.start },
            select: { id: true },
          });
          if (!exists && (await issueInvoice(tx, { tenantId, kind: "MONTHLY", plan, today, periodStart: p.start, periodEnd: p.end }))) {
            summary.invoices++;
          }
          start = p.start;
          end = p.end;
        }
        if (end.getTime() !== fresh.currentPeriodEnd.getTime()) {
          await tx.tenantSubscription.update({
            where: { id: fresh.id },
            data: { currentPeriodStart: start, currentPeriodEnd: end },
          });
        }
      }

      // 3. Retard → lecture seule → suspension (ou retour à la normale).
      const before = (await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })).status;
      if ((await refreshBillingStatus(tx, tenantId, today)) !== before) summary.statusChanges++;

      // 4. Relances.
      const open = await tx.saasInvoice.findMany({ where: { tenantId, status: "OPEN" } });
      if (open.length) {
        const { name } = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
        const emails = await adminEmails(tx, tenantId);
        for (const invoice of open) {
          const key = reminderDue(daysBetween(invoice.dueOn, today), invoice.remindersSent);
          if (!key) continue;
          await tx.saasInvoice.update({ where: { id: invoice.id }, data: { remindersSent: { push: key } } });
          for (const to of emails) out.push(reminderMail(to, name, invoice, key));
          summary.reminders++;
        }
      }
      return out;
    });
    for (const mail of mails) {
      await sendMail(mail).catch((error) =>
        console.error("[facturation] relance non envoyée", error instanceof Error ? error.message : error),
      );
    }
  }
  return summary;
}

// --- Paiement en ligne par la salle ------------------------------------------------

/** Lance le paiement Mobile Money d'une facture (contexte de la salle). */
export async function startInvoicePayment(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  invoiceId: string,
  provider: PaymentProvider,
  urls: (paymentId: string) => { returnUrl: string; notifyUrl: string },
) {
  const invoice = await tx.saasInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.status !== "OPEN") throw new BusinessError("Cette facture n'est plus à régler.");
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: actor.tenantId },
    select: { name: true, phone: true, email: true },
  });
  const payment = await tx.saasPayment.create({
    data: {
      tenantId: actor.tenantId,
      invoiceId: invoice.id,
      amountXof: invoice.amountXof,
      provider: provider.id,
      expiresAt: new Date(Date.now() + BILLING_RULES.paymentTtlMinutes * 60_000),
      createdById: actor.userId,
    },
  });
  const { providerRef, checkoutUrl } = await provider.initiate({
    paymentId: payment.id,
    amountXof: invoice.amountXof,
    description: `ZAHFIT — facture ${invoice.number}`,
    customer: { name: tenant.name, phone: tenant.phone ?? "", email: tenant.email },
    ...urls(payment.id),
  });
  await tx.saasPayment.update({ where: { id: payment.id }, data: { providerRef } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "saas_payment.start",
    entityType: "saas_invoice",
    entityId: invoice.id,
    after: { paymentId: payment.id, amountXof: invoice.amountXof, provider: provider.id },
  });
  return { paymentId: payment.id, checkoutUrl };
}

/** Paiement d'une facture ZahDigit trouvé par sa référence prestataire (webhook). */
export function findSaasPaymentByRef(tx: Tx, provider: string, providerRef: string) {
  return tx.saasPayment.findFirst({ where: { provider, providerRef }, select: { id: true, tenantId: true } });
}

/**
 * Confirmation par le prestataire (webhook signé) : la facture est réglée et
 * le statut recalculé (sortie de lecture seule ou de suspension). Idempotent.
 */
export async function applySaasPaymentStatus(
  paymentId: string,
  status: "SUCCEEDED" | "FAILED" | "PENDING",
  amountXof: number | null,
  today = todayCalendar(),
) {
  return platform(async (tx) => {
    const payment = await tx.saasPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) return { outcome: "unknown_payment" as const };
    if (payment.status !== "PENDING") return { outcome: "already_processed" as const };
    if (status === "PENDING") return { outcome: "pending" as const };
    if (status === "FAILED") {
      await tx.saasPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      return { outcome: "failed" as const };
    }
    if (amountXof !== null && amountXof !== payment.amountXof) {
      await tx.saasPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      await audit(tx, {
        tenantId: payment.tenantId,
        action: "saas_payment.amount_mismatch",
        entityType: "saas_payment",
        entityId: payment.id,
        after: { expected: payment.amountXof, received: amountXof },
      });
      return { outcome: "amount_mismatch" as const };
    }
    const paidAt = new Date();
    await tx.saasPayment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", paidAt } });
    if (payment.invoice.status === "OPEN") {
      await tx.saasInvoice.update({
        where: { id: payment.invoiceId },
        data: { status: "PAID", paidAt, paymentMethod: "MOBILE_MONEY", paymentReference: payment.providerRef },
      });
    }
    await audit(tx, {
      tenantId: payment.tenantId,
      action: "saas_invoice.paid",
      entityType: "saas_invoice",
      entityId: payment.invoiceId,
      after: {
        number: payment.invoice.number,
        amountXof: payment.amountXof,
        method: "MOBILE_MONEY",
        reference: payment.providerRef,
      },
    });
    await refreshBillingStatus(tx, payment.tenantId, today);
    return { outcome: "confirmed" as const, tenantId: payment.tenantId };
  });
}

// --- Super Admin -------------------------------------------------------------------

export const markPaidSchema = z.object({
  invoiceId: z.uuid(),
  method: z.enum(["MOBILE_MONEY", "TRANSFER", "CASH", "CARD"], { error: "Choisissez le moyen de paiement." }),
  reference: optionalText(80),
});
export const voidInvoiceSchema = z.object({ invoiceId: z.uuid(), reason: requiredText("Le motif", 200) });
export const extendTrialSchema = z.object({
  tenantId: z.uuid(),
  days: z.coerce
    .number({ error: "Nombre de jours invalide." })
    .int()
    .min(1, "1 jour minimum.")
    .max(180, "180 jours maximum."),
});

/** Règlement reçu hors ligne (virement, espèces) : CONTEXTE PLATEFORME. */
export async function markInvoicePaid(tx: Tx, actorId: string, input: z.infer<typeof markPaidSchema>, today = todayCalendar()) {
  const invoice = await tx.saasInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice || invoice.status !== "OPEN") throw new BusinessError("Cette facture n'est plus ouverte.");
  await tx.saasInvoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", paidAt: new Date(), paymentMethod: input.method, paymentReference: input.reference },
  });
  await audit(tx, {
    tenantId: invoice.tenantId,
    actorUserId: actorId,
    action: "saas_invoice.paid",
    entityType: "saas_invoice",
    entityId: invoice.id,
    after: { number: invoice.number, amountXof: invoice.amountXof, method: input.method, reference: input.reference },
  });
  await refreshBillingStatus(tx, invoice.tenantId, today, actorId);
}

export async function voidSaasInvoice(tx: Tx, actorId: string, input: z.infer<typeof voidInvoiceSchema>, today = todayCalendar()) {
  const invoice = await tx.saasInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice || invoice.status !== "OPEN") throw new BusinessError("Seule une facture ouverte peut être annulée.");
  await tx.saasInvoice.update({ where: { id: invoice.id }, data: { status: "VOID", voidReason: input.reason } });
  await audit(tx, {
    tenantId: invoice.tenantId,
    actorUserId: actorId,
    action: "saas_invoice.void",
    entityType: "saas_invoice",
    entityId: invoice.id,
    before: { number: invoice.number, amountXof: invoice.amountXof },
    after: { reason: input.reason },
  });
  await refreshBillingStatus(tx, invoice.tenantId, today, actorId);
}

export async function extendTrial(tx: Tx, actorId: string, input: z.infer<typeof extendTrialSchema>) {
  const sub = await tx.tenantSubscription.findUnique({ where: { tenantId: input.tenantId } });
  if (!sub || sub.status !== "TRIALING" || !sub.trialEndsOn) throw new BusinessError("La salle n'est pas en période d'essai.");
  const trialEndsOn = addDays(sub.trialEndsOn, input.days);
  await tx.tenantSubscription.update({ where: { id: sub.id }, data: { trialEndsOn } });
  await audit(tx, {
    tenantId: input.tenantId,
    actorUserId: actorId,
    action: "billing.trial.extend",
    entityType: "tenant_subscription",
    entityId: sub.id,
    before: { trialEndsOn: sub.trialEndsOn.toISOString().slice(0, 10) },
    after: { trialEndsOn: trialEndsOn.toISOString().slice(0, 10) },
  });
}

// --- Lecture -----------------------------------------------------------------------

/** Abonnement et factures d'une salle (lisible par la salle elle-même, sous RLS). */
export async function tenantBilling(tx: Tx, tenantId: string) {
  const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
  const invoices = await tx.saasInvoice.findMany({
    where: { tenantId },
    orderBy: [{ issuedOn: "desc" }, { number: "desc" }],
  });
  const open = invoices.filter((i) => i.status === "OPEN");
  return { subscription, invoices, open, openTotal: open.reduce((s, i) => s + i.amountXof, 0) };
}

export function loadSaasPayment(tx: Tx, paymentId: string) {
  return tx.saasPayment.findUnique({
    where: { id: paymentId },
    select: { status: true, amountXof: true, invoice: { select: { number: true, status: true } } },
  });
}

export type InvoiceFilter = "ouvertes" | "en-retard" | "toutes";

export function listSaasInvoices(tx: Tx, filter: InvoiceFilter, today = todayCalendar()) {
  return tx.saasInvoice.findMany({
    where:
      filter === "ouvertes" ? { status: "OPEN" } : filter === "en-retard" ? { status: "OPEN", dueOn: { lt: today } } : {},
    orderBy: [{ issuedOn: "desc" }, { number: "desc" }],
    take: 200,
    include: { tenant: { select: { id: true, name: true } } },
  });
}

/**
 * Tableau de bord ZahDigit (30 derniers jours) : MRR, attrition, salles,
 * encours, volume des transactions des salles, réussite des paiements en ligne.
 */
export async function platformDashboard(tx: Tx, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const today = todayCalendar(now);
  const subs = await tx.tenantSubscription.findMany({
    select: {
      status: true,
      statusChangedAt: true,
      tenant: { select: { saasPlan: { select: { monthlyPriceXof: true } } } },
    },
  });
  const paying = subs.filter((s) => ["ACTIVE", "PAST_DUE", "READ_ONLY"].includes(s.status));
  const churned = subs.filter((s) => ["SUSPENDED", "CANCELLED"].includes(s.status) && s.statusChangedAt >= since).length;
  const open = await tx.saasInvoice.findMany({ where: { status: "OPEN" }, select: { amountXof: true, dueOn: true } });
  const volume = await tx.payment.aggregate({
    where: { status: "SUCCEEDED", kind: "PAYMENT", paidAt: { gte: since } },
    _sum: { amountXof: true },
    _count: { _all: true },
  });
  const online = await tx.payment.groupBy({
    by: ["status"],
    where: { provider: { not: "manual" }, createdAt: { gte: since }, status: { in: ["SUCCEEDED", "FAILED", "EXPIRED"] } },
    _count: { _all: true },
  });
  const saasOnline = await tx.saasPayment.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since }, status: { in: ["SUCCEEDED", "FAILED", "EXPIRED"] } },
    _count: { _all: true },
  });
  const rate = (rows: { status: string; _count: { _all: number } }[]) => {
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const ok = rows.find((r) => r.status === "SUCCEEDED")?._count._all ?? 0;
    return total ? Math.round((ok / total) * 100) : null;
  };
  return {
    mrrXof: paying.reduce((s, x) => s + x.tenant.saasPlan.monthlyPriceXof, 0),
    payingTenants: paying.length,
    trialing: subs.filter((s) => s.status === "TRIALING").length,
    pastDue: subs.filter((s) => ["PAST_DUE", "READ_ONLY"].includes(s.status)).length,
    suspended: subs.filter((s) => s.status === "SUSPENDED").length,
    churnRate: paying.length + churned ? Math.round((churned / (paying.length + churned)) * 100) : 0,
    churned,
    outstandingXof: open.reduce((s, i) => s + i.amountXof, 0),
    overdueXof: open.filter((i) => i.dueOn < today).reduce((s, i) => s + i.amountXof, 0),
    transactions: { count: volume._count._all, amountXof: volume._sum.amountXof ?? 0 },
    onlineSuccessRate: rate(online),
    saasSuccessRate: rate(saasOnline),
  };
}
