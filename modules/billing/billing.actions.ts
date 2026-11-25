"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { ok, requireActionContext, requirePlatformActionUser, toFormState } from "@/lib/actions";
import { withPlatform, withTenant } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import {
  extendTrial,
  extendTrialSchema,
  markInvoicePaid,
  markPaidSchema,
  startInvoicePayment,
  voidInvoiceSchema,
  voidSaasInvoice,
} from "@/modules/billing/billing.service";
import { activeOnlineProvider } from "@/modules/payments/providers";

const appUrl = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3100").replace(/\/$/, "");

/**
 * Règlement d'une facture ZahDigit par la salle (Mobile Money). Possible même
 * en lecture seule ou suspendue : c'est précisément ce qui lève le blocage.
 */
export async function startInvoicePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let destination: string;
  try {
    const ctx = await requireActionContext("billing.settings.manage", undefined, {
      allowReadOnly: true,
      allowSuspended: true,
    });
    const invoiceId = z.uuid().safeParse(formData.get("invoiceId"));
    if (!invoiceId.success) return { ok: false, message: "Facture introuvable." };
    const provider = activeOnlineProvider();
    if (!provider) return { ok: false, message: "Le paiement en ligne n'est pas disponible : contactez ZahDigit." };
    const base = appUrl();
    const { checkoutUrl } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      startInvoicePayment(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, invoiceId.data, provider, (paymentId) => ({
        returnUrl: `${base}/facturation?paiement=${paymentId}`,
        notifyUrl: `${base}/api/webhooks/paiements/${provider.id}`,
      })),
    );
    destination = checkoutUrl;
  } catch (error) {
    return toFormState(error);
  }
  redirect(destination);
}

export async function markInvoicePaidAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(markPaidSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => markInvoicePaid(tx, actor.id, parsed.data));
    return ok("Facture marquée comme réglée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function voidSaasInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(voidInvoiceSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => voidSaasInvoice(tx, actor.id, parsed.data));
    return ok("Facture annulée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function extendTrialAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(extendTrialSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => extendTrial(tx, actor.id, parsed.data));
    return ok(`Essai prolongé de ${parsed.data.days} jour(s).`);
  } catch (error) {
    return toFormState(error);
  }
}
