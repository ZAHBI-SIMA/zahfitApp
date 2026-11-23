"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { checkbox, parseForm, type FormState } from "@/lib/validation";
import { unsubscribeWithToken, updateMessagingSettings } from "@/modules/messaging/messaging.service";

/** Canaux payants : réservé à qui gère la facturation (coût par message). */
export async function updateMessagingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("billing.settings.manage");
    const parsed = parseForm(z.object({ whatsappEnabled: checkbox, smsEnabled: checkbox }), formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateMessagingSettings(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    return ok("Canaux de messages enregistrés.");
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * Désinscription publique (lien signé d'un SMS). Confirmée par un bouton :
 * un simple aperçu du lien (antivirus, messagerie) ne désinscrit personne.
 */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await unsubscribeWithToken(token);
  redirect(`/desinscription/${encodeURIComponent(token)}?${result.ok ? "fait=1" : "invalide=1"}`);
}
