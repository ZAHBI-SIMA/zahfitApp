"use server";

import { redirect } from "next/navigation";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import { createPlan, planInputSchema, updatePlan } from "@/modules/plans/plans.service";

export async function createPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("plans.manage");
    const parsed = parseForm(planInputSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      createPlan(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
  } catch (error) {
    return toFormState(error);
  }
  redirect("/admin/formules?cree=1");
}

export async function updatePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("plans.manage");
    const parsed = parseForm(planInputSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updatePlan(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, String(formData.get("id")), parsed.data),
    );
    return ok("Formule enregistrée. Les abonnements déjà vendus conservent leur prix et leur durée.");
  } catch (error) {
    return toFormState(error);
  }
}
