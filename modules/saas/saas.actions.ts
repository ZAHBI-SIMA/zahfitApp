"use server";

import * as z from "zod";
import { ok, requirePlatformActionUser, toFormState } from "@/lib/actions";
import { withPlatform } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import {
  changeTenantPlan,
  createSaasPlan,
  newSaasPlanSchema,
  saasPlanSchema,
  updateSaasPlan,
} from "@/modules/saas/saas.service";

/** Forfaits et changement de forfait : réservés à l'équipe ZahDigit (contexte plateforme). */

export async function createSaasPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(newSaasPlanSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => createSaasPlan(tx, actor.id, parsed.data));
    return ok("Forfait créé.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateSaasPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const id = z.uuid().safeParse(formData.get("planId"));
    if (!id.success) return { ok: false, message: "Forfait introuvable." };
    const parsed = parseForm(saasPlanSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => updateSaasPlan(tx, actor.id, id.data, parsed.data));
    return ok("Forfait enregistré : les salles concernées en bénéficient immédiatement.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function changeTenantPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const tenantId = z.uuid().safeParse(formData.get("tenantId"));
    const planId = z.uuid().safeParse(formData.get("planId"));
    if (!tenantId.success || !planId.success) return { ok: false, message: "Choisissez un forfait." };
    const plan = await withPlatform(actor.id, (tx) => changeTenantPlan(tx, actor.id, tenantId.data, planId.data));
    return ok(`Forfait ${plan.name} appliqué.`);
  } catch (error) {
    return toFormState(error);
  }
}
