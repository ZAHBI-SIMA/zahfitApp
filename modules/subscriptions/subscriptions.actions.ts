"use server";

import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { sendReceiptByEmail } from "@/modules/payments/receipt-email";
import { requirePermission } from "@/lib/rbac/guard";
import { can } from "@/lib/rbac/permissions";
import { parseForm, type FormState } from "@/lib/validation";
import { todayCalendar } from "@/modules/subscriptions/dates";
import {
  assignSchema,
  assignSubscription,
  cancelSchema,
  cancelSubscription,
  extendSchema,
  extendSubscription,
  freezeSubscription,
  paymentSchema,
  recordManualPayment,
  unfreezeSubscription,
} from "@/modules/subscriptions/subscriptions.service";

const subscriptionIdOf = (formData: FormData) => String(formData.get("subscriptionId") ?? "");

function receiptMessage(collected: { receipt: { number: string }; balanceAfter: number }, emailed: boolean) {
  const balance = collected.balanceAfter > 0 ? ` Reste à payer : ${formatXof(collected.balanceAfter)}.` : " Abonnement soldé.";
  return `Reçu ${collected.receipt.number}${emailed ? " envoyé par e-mail" : ""}.${balance}`;
}

export async function assignSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("subscriptions.write");
    const parsed = parseForm(assignSchema, formData);
    if (parsed.state) return parsed.state;

    // Encaissement immédiat : droit et données de paiement vérifiés AVANT toute écriture.
    let payment = null;
    if (parsed.data.collectNow) {
      requirePermission(ctx, "payments.collect");
      const paid = parseForm(paymentSchema, formData);
      if (paid.state) return paid.state;
      payment = paid.data;
    }

    const actor = { tenantId: ctx.tenant.id, userId: ctx.user.id };
    const { sub, collected } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const created = await assignSubscription(tx, actor, parsed.data, todayCalendar());
      const result = payment && created.priceXof > 0 ? await recordManualPayment(tx, actor, created.id, payment) : null;
      return { sub: created, collected: result };
    });
    const period = `du ${formatDate(sub.startDate)} au ${formatDate(sub.endDate)}`;
    if (collected) {
      const emailed = await sendReceiptByEmail(actor, collected.receipt.id);
      return ok(`Abonnement « ${sub.planName} » actif ${period}. ${receiptMessage(collected, emailed)}`);
    }
    return ok(
      sub.priceXof === 0
        ? `Abonnement « ${sub.planName} » actif ${period}.`
        : `Abonnement « ${sub.planName} » créé ${period}, en attente de paiement.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function collectPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("payments.collect");
    const parsed = parseForm(paymentSchema, formData);
    if (parsed.state) return parsed.state;
    const actor = { tenantId: ctx.tenant.id, userId: ctx.user.id };
    const collected = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      recordManualPayment(tx, actor, subscriptionIdOf(formData), parsed.data),
    );
    const emailed = await sendReceiptByEmail(actor, collected.receipt.id);
    return ok(`Paiement enregistré. ${receiptMessage(collected, emailed)}`);
  } catch (error) {
    return toFormState(error);
  }
}

export async function freezeSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("subscriptions.write");
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      freezeSubscription(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, subscriptionIdOf(formData), todayCalendar()),
    );
    return ok("Abonnement suspendu à partir d'aujourd'hui.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function unfreezeSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("subscriptions.write");
    const result = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      unfreezeSubscription(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, subscriptionIdOf(formData), todayCalendar()),
    );
    const extra = result.overflow > 0 ? ` (${result.overflow} jour(s) au-delà du plafond non rendus)` : "";
    return ok(`Abonnement repris : fin repoussée de ${result.credited} jour(s)${extra}.`);
  } catch (error) {
    return toFormState(error);
  }
}

export async function extendSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    // Prolonger gratuitement est un geste commercial : gérant ou administrateur.
    const ctx = await requireActionContext("plans.manage");
    const parsed = parseForm(extendSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      extendSubscription(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data, todayCalendar()),
    );
    return ok(`Abonnement prolongé de ${parsed.data.days} jour(s).`);
  } catch (error) {
    return toFormState(error);
  }
}

export async function cancelSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("subscriptions.write");
    const parsed = parseForm(cancelSchema, formData);
    if (parsed.state) return parsed.state;
    const { paid } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      cancelSubscription(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data, {
        canCancelPaid: can(ctx.role, "plans.manage"),
      }),
    );
    return ok(
      paid
        ? "Abonnement annulé. Aucun remboursement automatique : à traiter manuellement (remboursements au Sprint 4)."
        : "Abonnement annulé.",
    );
  } catch (error) {
    return toFormState(error);
  }
}
