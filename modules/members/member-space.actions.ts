"use server";

import { redirect } from "next/navigation";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import { consentsSchema, createSelfRenewalLink, updateMyConsents } from "@/modules/members/member-space.service";
import { activeOnlineProvider } from "@/modules/payments/providers";

export async function updateMyConsentsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("self.profile");
    const parsed = parseForm(consentsSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateMyConsents(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    return ok("Préférences enregistrées.");
  } catch (error) {
    return toFormState(error);
  }
}

/** « Renouveler en ligne » : crée un lien à usage unique et y conduit l'adhérent. */
export async function renewOnlineAction(): Promise<FormState> {
  let path: string;
  try {
    const ctx = await requireActionContext("self.subscription");
    if (!activeOnlineProvider()) {
      return { ok: false, message: "Le paiement en ligne n'est pas disponible : renouvelez à l'accueil." };
    }
    path = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => createSelfRenewalLink(tx, ctx.tenant.id, ctx.user.id));
  } catch (error) {
    return toFormState(error);
  }
  redirect(path);
}
