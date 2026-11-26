"use server";

import { redirect } from "next/navigation";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import { finishOnboarding, isStepKey, skipOnboardingStep, stepSchema } from "@/modules/onboarding/onboarding.service";

/** L'assistant est celui du propriétaire de la salle : il touche à l'équipe et à la facturation. */
const PERMISSION = "staff.manage" as const;

export async function skipOnboardingStepAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext(PERMISSION);
    const parsed = parseForm(stepSchema, formData);
    if (parsed.state) return parsed.state;
    const step = parsed.data.step;
    if (!isStepKey(step)) return { ok: false, message: "Étape inconnue." };
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      skipOnboardingStep(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, step),
    );
    return ok("Étape passée : vous pourrez y revenir à tout moment depuis le menu.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function finishOnboardingAction(): Promise<FormState> {
  try {
    const ctx = await requireActionContext(PERMISSION);
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      finishOnboarding(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }),
    );
  } catch (error) {
    return toFormState(error);
  }
  redirect("/admin?demarrage=termine");
}
