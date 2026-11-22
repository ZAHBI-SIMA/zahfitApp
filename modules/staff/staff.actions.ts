"use server";

import { requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { findOrCreateUser, sendActivationLinkIfNeeded } from "@/lib/invite";
import { parseForm, type FormState } from "@/lib/validation";
import {
  addStaffMember,
  changeStaffRole,
  setStaffStatus,
  staffInviteSchema,
  staffRoleSchema,
} from "@/modules/staff/staff.service";

export async function inviteStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("staff.manage");
    const parsed = parseForm(staffInviteSchema, formData);
    if (parsed.state) return parsed.state;

    const user = await findOrCreateUser(parsed.data.email, parsed.data.name);
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      addStaffMember(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, user.id, parsed.data),
    );
    const sent = await sendActivationLinkIfNeeded(user.id, parsed.data.email);
    return {
      ok: true,
      message: sent
        ? `Invitation envoyée à ${parsed.data.email} : un lien pour choisir son mot de passe (valable 24 h).`
        : `${parsed.data.name} a déjà un compte ZAHFIT : l'accès à la salle est actif immédiatement.`,
    };
  } catch (error) {
    return toFormState(error);
  }
}

export async function changeStaffRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("staff.manage");
    const parsed = parseForm(staffRoleSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      changeStaffRole(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.membershipId, parsed.data.role),
    );
    return { ok: true, message: "Rôle modifié." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function setStaffStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("staff.manage");
    const status = formData.get("status") === "DISABLED" ? "DISABLED" : "ACTIVE";
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      setStaffStatus(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, String(formData.get("membershipId")), status),
    );
    return { ok: true, message: status === "DISABLED" ? "Accès désactivé." : "Accès réactivé." };
  } catch (error) {
    return toFormState(error);
  }
}
