"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { getTenantContext } from "@/lib/session";
import { parseForm, requiredText, type FormState } from "@/lib/validation";
import {
  cancelSession,
  classTypeSchema,
  createOneOffSession,
  createSeries,
  oneOffSchema,
  parseStaffProfile,
  restoreSession,
  roomSchema,
  saveClassType,
  saveRoom,
  seriesSchema,
  sessionUpdateSchema,
  stopSeries,
  tenantToday,
  updateSeries,
  updateSession,
  updateStaffProfile,
} from "@/modules/classes/classes.service";

/** Contexte « gestion des cours » : permission classes.manage (admin, gérant). */
async function manage() {
  const ctx = await requireActionContext("classes.manage");
  return { ctx, actor: { tenantId: ctx.tenant.id, userId: ctx.user.id } };
}

const optionalId = (formData: FormData, key: string) => {
  const value = String(formData.get(key) ?? "");
  return z.uuid().safeParse(value).success ? value : undefined;
};

// --- Salles de cours et types ------------------------------------------------

export async function saveRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(roomSchema, formData);
    if (parsed.state) return parsed.state;
    const roomId = optionalId(formData, "roomId");
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => saveRoom(tx, actor, parsed.data, roomId));
    return ok(roomId ? "Salle de cours enregistrée." : "Salle de cours ajoutée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function saveClassTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(classTypeSchema, formData);
    if (parsed.state) return parsed.state;
    const typeId = optionalId(formData, "typeId");
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => saveClassType(tx, actor, parsed.data, typeId));
    return ok(typeId ? "Type de cours enregistré." : "Type de cours ajouté.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Cours réguliers -------------------------------------------------------------

export async function createSeriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let count = 0;
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(seriesSchema, formData);
    if (parsed.state) return parsed.state;
    count = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const { today } = await tenantToday(tx, ctx.tenant.id);
      return (await createSeries(tx, actor, parsed.data, today)).count;
    });
  } catch (error) {
    return toFormState(error);
  }
  redirect(`/admin/planning/cours?cree=${count}`);
}

export async function updateSeriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(seriesSchema, formData);
    if (parsed.state) return parsed.state;
    const seriesId = optionalId(formData, "seriesId");
    if (!seriesId) throw new BusinessError("Cours régulier introuvable.");
    const { count } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const { today } = await tenantToday(tx, ctx.tenant.id);
      return updateSeries(tx, actor, seriesId, parsed.data, today);
    });
    return ok(
      `Cours enregistré : ${count} séance(s) à venir recalculée(s). Les séances modifiées une par une sont conservées.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function stopSeriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(
      z.object({ seriesId: z.uuid(), lastDay: z.iso.date({ error: "Date invalide." }) }),
      formData,
    );
    if (parsed.state) return parsed.state;
    const { removed, cancelled } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      stopSeries(tx, actor, parsed.data.seriesId, parsed.data.lastDay),
    );
    return ok(`Cours arrêté : ${removed} séance(s) retirée(s)${cancelled ? `, ${cancelled} annulée(s)` : ""}.`);
  } catch (error) {
    return toFormState(error);
  }
}

// --- Séances ------------------------------------------------------------------

export async function createOneOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let sessionId = "";
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(oneOffSchema, formData);
    if (parsed.state) return parsed.state;
    sessionId = (await withTenant(ctx.tenant.id, ctx.user.id, (tx) => createOneOffSession(tx, actor, parsed.data))).id;
  } catch (error) {
    return toFormState(error);
  }
  redirect(`/admin/planning/seance/${sessionId}?cree=1`);
}

export async function updateSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(sessionUpdateSchema, formData);
    if (parsed.state) return parsed.state;
    const sessionId = optionalId(formData, "sessionId");
    if (!sessionId) throw new BusinessError("Séance introuvable.");
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => updateSession(tx, actor, sessionId, parsed.data));
    return ok("Séance modifiée. Le cours régulier ne la réécrira plus.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function cancelSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(z.object({ sessionId: z.uuid(), reason: requiredText("Le motif", 200) }), formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      cancelSession(tx, actor, parsed.data.sessionId, parsed.data.reason),
    );
    return ok("Séance annulée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function restoreSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, actor } = await manage();
    const parsed = parseForm(z.object({ sessionId: z.uuid() }), formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => restoreSession(tx, actor, parsed.data.sessionId));
    return ok("Séance rétablie.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Profil employé ------------------------------------------------------------

/**
 * L'administrateur (staff.manage) modifie tous les profils ; un coach peut
 * modifier SON profil (spécialités, disponibilités) depuis son espace.
 */
export async function updateStaffProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const membershipId = optionalId(formData, "membershipId");
    if (!membershipId) throw new BusinessError("Membre de l'équipe introuvable.");
    const current = await getTenantContext();
    const own = current
      ? await withTenant(current.tenant.id, current.user.id, (tx) =>
          tx.tenantMembership.findFirst({ where: { id: membershipId, userId: current.user.id }, select: { id: true } }),
        )
      : null;
    // Toutes les vérifications (salle, 2FA, permission) sont refaites ici.
    const ctx = await requireActionContext(own ? "classes.read" : "staff.manage");

    const { errors, data } = parseStaffProfile(formData);
    if (Object.keys(errors).length) return { ok: false, message: "Corrigez les champs indiqués.", errors };
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateStaffProfile(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, membershipId, data),
    );
    return ok("Profil enregistré.");
  } catch (error) {
    return toFormState(error);
  }
}
