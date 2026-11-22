"use server";

import { redirect } from "next/navigation";
import { requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import {
  IMPORT_MAX_BYTES,
  analyzeMemberCsv,
  importMembers,
  loadExistingPhones,
  type ImportAnalysis,
} from "@/modules/members/members.import";
import { memberInputSchema, parseBasePath } from "@/modules/members/members.schema";
import { createMember, setMemberArchived, updateMember } from "@/modules/members/members.service";

export async function createMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const basePath = parseBasePath(formData.get("basePath"));
  let memberId: string;
  try {
    const ctx = await requireActionContext("members.write");
    const parsed = parseForm(memberInputSchema, formData);
    if (parsed.state) return parsed.state;
    const member = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      createMember(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    memberId = member.id;
  } catch (error) {
    return toFormState(error);
  }
  // redirect() hors du try : il fonctionne en levant une exception.
  redirect(`${basePath}/${memberId}?cree=1`);
}

export async function updateMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("members.write");
    const parsed = parseForm(memberInputSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateMember(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, String(formData.get("id")), parsed.data),
    );
    return { ok: true, message: "Fiche enregistrée." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function setMemberArchivedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("members.archive");
    const archived = formData.get("archived") === "true";
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      setMemberArchived(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, String(formData.get("id")), archived),
    );
    return { ok: true, message: archived ? "Adhérent archivé." : "Adhérent restauré." };
  } catch (error) {
    return toFormState(error);
  }
}

// --- Import CSV ---------------------------------------------------------------

export type ImportState = FormState & { analysis?: ImportAnalysis; imported?: number };

/**
 * Étape 1 (intent=preview) : analyse SANS écrire.
 * Étape 2 (intent=commit) : le même fichier est renvoyé et ré-analysé côté
 * serveur — on ne fait jamais confiance à un aperçu venu du navigateur.
 */
export async function importMembersAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choisissez un fichier CSV." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: "Fichier trop volumineux (1 Mo maximum)." };

  try {
    const ctx = await requireActionContext("members.write");
    const text = await file.text();
    const commit = formData.get("intent") === "commit";

    const result = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const analysis = analyzeMemberCsv(text, await loadExistingPhones(tx));
      const canImport = commit && analysis.missingColumns.length === 0;
      const imported = canImport
        ? await importMembers(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, analysis)
        : undefined;
      return { analysis, imported };
    });

    if (result.analysis.missingColumns.length > 0) {
      return {
        ok: false,
        message: `Colonnes manquantes : ${result.analysis.missingColumns.join(", ")}. Utilisez le modèle fourni.`,
      };
    }
    if (result.imported !== undefined) {
      return { ok: true, imported: result.imported, message: `${result.imported} adhérent(s) importé(s).` };
    }
    return { ok: true, analysis: result.analysis };
  } catch (error) {
    return toFormState(error);
  }
}
