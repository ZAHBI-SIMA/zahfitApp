"use server";

import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { parseForm, type FormState } from "@/lib/validation";
import {
  MAX_ATTACHMENT_BYTES,
  addAttachment,
  categorySchema,
  createCategory,
  createExpense,
  expenseSchema,
  removeAttachment,
  setCategoryActive,
  voidExpense,
  voidExpenseSchema,
} from "@/modules/expenses/expenses.service";

const actorOf = (ctx: { tenant: { id: string }; user: { id: string } }) => ({ tenantId: ctx.tenant.id, userId: ctx.user.id });

/** Fichier facultatif du formulaire : lu en mémoire (5 Mo max, vérifié avant lecture). */
async function readFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_ATTACHMENT_BYTES) throw new BusinessError("Fichier trop volumineux : 5 Mo maximum.", "file");
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Dépense + justificatif éventuel dans la MÊME transaction : tout ou rien. */
export async function createExpenseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const parsed = parseForm(expenseSchema, formData);
    if (parsed.state) return parsed.state;
    const file = await readFile(formData);
    await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const expense = await createExpense(tx, actorOf(ctx), parsed.data);
      if (file) await addAttachment(tx, actorOf(ctx), expense.id, file);
    });
    return ok("Dépense enregistrée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function voidExpenseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const parsed = parseForm(voidExpenseSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => voidExpense(tx, actorOf(ctx), parsed.data));
    return ok("Dépense annulée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function addAttachmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const expenseId = z.uuid().safeParse(formData.get("expenseId"));
    if (!expenseId.success) return { ok: false, message: "Dépense introuvable." };
    const file = await readFile(formData);
    if (!file) return { ok: false, message: "Choisissez un fichier.", errors: { file: ["Choisissez un fichier."] } };
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => addAttachment(tx, actorOf(ctx), expenseId.data, file));
    return ok("Justificatif ajouté.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function removeAttachmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const id = z.uuid().safeParse(formData.get("attachmentId"));
    if (!id.success) return { ok: false, message: "Justificatif introuvable." };
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => removeAttachment(tx, actorOf(ctx), id.data));
    return ok("Justificatif retiré.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const parsed = parseForm(categorySchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => createCategory(tx, actorOf(ctx), parsed.data));
    return ok("Catégorie ajoutée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function toggleCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("expenses.manage");
    const id = z.uuid().safeParse(formData.get("categoryId"));
    if (!id.success) return { ok: false, message: "Catégorie introuvable." };
    const isActive = formData.get("isActive") === "true";
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => setCategoryActive(tx, actorOf(ctx), id.data, isActive));
    return ok(isActive ? "Catégorie réactivée." : "Catégorie masquée.");
  } catch (error) {
    return toFormState(error);
  }
}
