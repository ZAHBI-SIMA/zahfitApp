"use server";

import { redirect } from "next/navigation";
import { ok, requireActionContext, requirePlatformActionUser, toFormState } from "@/lib/actions";
import { withPlatform, withTenant } from "@/lib/db";
import { findOrCreateUser, sendActivationLinkIfNeeded } from "@/lib/invite";
import { parseForm, type FormState } from "@/lib/validation";
import {
  parseOpeningHours,
  tenantCreateSchema,
  tenantSettingsSchema,
  tenantUpdateSchema,
} from "@/modules/tenants/tenants.schema";
import {
  createTenant,
  setTenantSuspended,
  updateTenant,
  updateTenantSettings,
} from "@/modules/tenants/tenants.service";

export async function createTenantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let tenantId: string;
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(tenantCreateSchema, formData);
    if (parsed.state) return parsed.state;

    const admin = await findOrCreateUser(parsed.data.adminEmail, parsed.data.adminName);
    const tenant = await withPlatform(actor.id, (tx) => createTenant(tx, actor.id, parsed.data, admin.id));
    // Envoi APRÈS la transaction : pas d'e-mail pour une salle qui n'existe pas.
    await sendActivationLinkIfNeeded(admin.id, parsed.data.adminEmail);
    tenantId = tenant.id;
  } catch (error) {
    return toFormState(error);
  }
  redirect(`/super-admin/salles/${tenantId}?cree=1`);
}

export async function updateTenantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(tenantUpdateSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => updateTenant(tx, actor.id, String(formData.get("id")), parsed.data));
    return ok("Salle enregistrée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function setTenantSuspendedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const suspended = formData.get("suspended") === "true";
    const reason = String(formData.get("reason") ?? "").trim() || null;
    await withPlatform(actor.id, (tx) =>
      setTenantSuspended(tx, actor.id, String(formData.get("id")), suspended, reason),
    );
    return ok(suspended ? "Salle suspendue." : "Salle réactivée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateTenantSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("tenant.settings.manage");
    const parsed = parseForm(tenantSettingsSchema, formData);
    const hours = parseOpeningHours(formData);
    if (parsed.state || Object.keys(hours.errors).length > 0) {
      return {
        ok: false,
        message: "Certains champs sont à corriger.",
        errors: { ...(parsed.state?.errors ?? {}), ...hours.errors },
      };
    }
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateTenantSettings(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data, hours.hours),
    );
    return ok("Paramètres enregistrés.");
  } catch (error) {
    return toFormState(error);
  }
}
