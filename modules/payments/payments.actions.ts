"use server";

import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { parseForm, type FormState } from "@/lib/validation";
import {
  billingSettingsSchema,
  refundPayment,
  refundSchema,
  updateBillingSettings,
} from "@/modules/payments/payments.service";
import { sendReceiptByEmail } from "@/modules/payments/receipt-email";
import { cancelSubscription } from "@/modules/subscriptions/subscriptions.service";

/**
 * Remboursement (gérant ou administrateur, 2FA obligatoire via la matrice).
 * Peut annuler l'abonnement dans la même transaction : soit tout passe, soit rien.
 */
export async function refundPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("payments.refund");
    const parsed = parseForm(refundSchema, formData);
    if (parsed.state) return parsed.state;
    const actor = { tenantId: ctx.tenant.id, userId: ctx.user.id };

    const { refund, receipt } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const result = await refundPayment(tx, actor, parsed.data);
      if (parsed.data.cancelSubscription && result.refund.subscriptionId) {
        await cancelSubscription(
          tx,
          actor,
          { subscriptionId: result.refund.subscriptionId, reason: parsed.data.reason },
          { canCancelPaid: true },
        );
      }
      return result;
    });
    const emailed = await sendReceiptByEmail(actor, receipt.id);
    return ok(
      `Remboursement de ${formatXof(refund.amountXof)} enregistré — avoir ${receipt.number}${emailed ? " envoyé par e-mail" : ""}.` +
        (parsed.data.cancelSubscription ? " Abonnement annulé." : ""),
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateBillingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("billing.settings.manage");
    const parsed = parseForm(billingSettingsSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateBillingSettings(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    return ok("Paramètres d'encaissement enregistrés.");
  } catch (error) {
    return toFormState(error);
  }
}
