"use server";

import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { parseForm, type FormState } from "@/lib/validation";
import {
  addManualMovement,
  cashSettingsSchema,
  closeCashSession,
  closeSessionSchema,
  manualMovementSchema,
  openCashSession,
  openSessionSchema,
  updateCashSettings,
  validateCashSession,
  validateSessionSchema,
} from "@/modules/cash/cash.service";

const actorOf = (ctx: { tenant: { id: string }; user: { id: string } }) => ({ tenantId: ctx.tenant.id, userId: ctx.user.id });

export async function openCashSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("cash.operate");
    const parsed = parseForm(openSessionSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => openCashSession(tx, actorOf(ctx), parsed.data));
    return ok(`Caisse ouverte avec un fond de ${formatXof(parsed.data.openingFloatXof)}.`);
  } catch (error) {
    return toFormState(error);
  }
}

export async function addCashMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("cash.operate");
    const parsed = parseForm(manualMovementSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => addManualMovement(tx, actorOf(ctx), parsed.data));
    return ok(parsed.data.kind === "DEPOSIT" ? "Apport enregistré." : "Retrait enregistré.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function closeCashSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("cash.operate");
    const parsed = parseForm(closeSessionSchema, formData);
    if (parsed.state) return parsed.state;
    const session = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => closeCashSession(tx, actorOf(ctx), parsed.data));
    const diff = session.differenceXof ?? 0;
    return ok(
      diff === 0
        ? "Caisse clôturée, sans écart. Elle attend la validation du gérant."
        : `Caisse clôturée avec un écart de ${formatXof(diff)}. Elle attend la validation du gérant.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function validateCashSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("cash.manage");
    const parsed = parseForm(validateSessionSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => validateCashSession(tx, actorOf(ctx), ctx.role, parsed.data));
    return ok("Caisse validée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateCashSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("cash.manage");
    const parsed = parseForm(cashSettingsSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => updateCashSettings(tx, actorOf(ctx), parsed.data));
    return ok("Réglage de caisse enregistré.");
  } catch (error) {
    return toFormState(error);
  }
}
