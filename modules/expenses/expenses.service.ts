import { createHash } from "node:crypto";
import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { optionalText, requiredText } from "@/lib/validation";
import { recordCashMovement } from "@/modules/cash/cash.service";
import { addDays, daysBetween, parseCalendarDate, todayCalendar } from "@/modules/subscriptions/dates";

type Actor = { tenantId: string; userId: string };

/** Catégories proposées à la première utilisation ; la salle peut en ajouter. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Loyer",
  "Électricité et eau",
  "Salaires et primes",
  "Entretien et réparations",
  "Matériel et équipements",
  "Produits d'entretien",
  "Communication et publicité",
  "Internet et téléphone",
  "Impôts et taxes",
  "Divers",
];

/** Saisie rétroactive limitée : au-delà, la période est en principe déjà déclarée. */
const BACKDATE_LIMIT_DAYS = 366;

export const expenseSchema = z.object({
  categoryId: z.uuid("Choisissez une catégorie."),
  label: requiredText("Le libellé", 120),
  supplier: optionalText(120),
  amountXof: z
    .string({ error: "Le montant est obligatoire." })
    .transform((v) => v.replace(/[^\d]/g, ""))
    .refine((v) => v.length > 0, "Le montant est obligatoire.")
    .transform(Number)
    .refine((n) => Number.isInteger(n) && n > 0 && n <= 50_000_000, "Montant invalide."),
  spentOn: z
    .string({ error: "La date est obligatoire." })
    .transform((v, ctx) => {
      const date = parseCalendarDate(v);
      if (!date) {
        ctx.addIssue({ code: "custom", message: "Date invalide." });
        return z.NEVER;
      }
      return date;
    }),
  method: z.enum(["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"], { error: "Choisissez le moyen de paiement." }),
  reference: optionalText(80),
  note: optionalText(500),
});

export const voidExpenseSchema = z.object({
  expenseId: z.uuid(),
  reason: requiredText("Le motif", 200),
});

export const categorySchema = z.object({ name: requiredText("Le nom", 60) });

// --- Catégories ------------------------------------------------------------------

export async function listCategories(tx: Tx, tenantId: string) {
  const existing = await tx.expenseCategory.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  if (existing.length > 0) return existing;
  await tx.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ tenantId, name })),
    skipDuplicates: true,
  });
  return tx.expenseCategory.findMany({ orderBy: { name: "asc" } });
}

export async function createCategory(tx: Tx, actor: Actor, input: z.infer<typeof categorySchema>) {
  const duplicate = await tx.expenseCategory.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) throw new BusinessError("Cette catégorie existe déjà.", "name");
  const category = await tx.expenseCategory.create({ data: { tenantId: actor.tenantId, name: input.name } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense_category.create",
    entityType: "expense_category",
    entityId: category.id,
    after: { name: input.name },
  });
  return category;
}

/** Une catégorie utilisée n'est jamais supprimée : on la masque des nouvelles saisies. */
export async function setCategoryActive(tx: Tx, actor: Actor, categoryId: string, isActive: boolean) {
  const category = await tx.expenseCategory.update({ where: { id: categoryId }, data: { isActive } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense_category.update",
    entityType: "expense_category",
    entityId: category.id,
    after: { isActive },
  });
  return category;
}

// --- Dépenses ------------------------------------------------------------------

export async function createExpense(tx: Tx, actor: Actor, input: z.infer<typeof expenseSchema>, today = todayCalendar()) {
  if (input.spentOn > today) throw new BusinessError("La date ne peut pas être dans le futur.", "spentOn");
  if (daysBetween(input.spentOn, today) > BACKDATE_LIMIT_DAYS) {
    throw new BusinessError("Date trop ancienne : plus d'un an.", "spentOn");
  }
  const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category?.isActive) throw new BusinessError("Choisissez une catégorie active.", "categoryId");

  const expense = await tx.expense.create({
    data: { ...input, tenantId: actor.tenantId, recordedById: actor.userId },
  });
  // Payée en espèces : la somme sort de la caisse (refusé si la caisse ne la contient pas).
  if (input.method === "CASH") {
    await recordCashMovement(tx, actor, {
      kind: "EXPENSE",
      amountXof: -input.amountXof,
      label: `${category.name} — ${input.label}`,
      expenseId: expense.id,
    });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense.create",
    entityType: "expense",
    entityId: expense.id,
    after: { category: category.name, label: input.label, amountXof: input.amountXof, method: input.method },
  });
  return expense;
}

/**
 * Annulation (erreur de saisie, doublon) : la dépense reste visible, barrée.
 * Payée en espèces, la sortie de caisse est contre-passée dans la caisse
 * ouverte : la caisse d'origine, déjà clôturée, n'est jamais réécrite.
 */
export async function voidExpense(tx: Tx, actor: Actor, input: z.infer<typeof voidExpenseSchema>) {
  const expense = await tx.expense.findUnique({ where: { id: input.expenseId } });
  if (!expense) throw new BusinessError("Dépense introuvable.");

  const updated = await tx.expense.updateMany({
    where: { id: expense.id, status: "RECORDED" }, // deux annulations simultanées : une seule passe
    data: { status: "VOIDED", voidReason: input.reason, voidedById: actor.userId, voidedAt: new Date() },
  });
  if (updated.count === 0) throw new BusinessError("Cette dépense est déjà annulée.");

  const cashOut = await tx.cashMovement.findFirst({ where: { expenseId: expense.id, kind: "EXPENSE" } });
  if (cashOut) {
    await recordCashMovement(tx, actor, {
      kind: "EXPENSE_VOID",
      amountXof: -cashOut.amountXof,
      label: `Annulation — ${expense.label}`,
      expenseId: expense.id,
    });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense.void",
    entityType: "expense",
    entityId: expense.id,
    before: { amountXof: expense.amountXof, label: expense.label },
    after: { reason: input.reason },
  });
}

/** Dépenses d'une période [from, to[, totaux par catégorie (annulées exclues des totaux). */
export async function listExpenses(tx: Tx, range: { from: Date; to: Date }) {
  const expenses = await tx.expense.findMany({
    where: { spentOn: { gte: range.from, lte: addDays(range.to, -1) } },
    orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
    include: {
      category: { select: { name: true } },
      attachments: { select: { id: true, fileName: true, sizeBytes: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const ids = [...new Set(expenses.flatMap((e) => [e.recordedById, e.voidedById]).filter((id): id is string => !!id))];
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));

  const byCategory = new Map<string, number>();
  const byMethod = new Map<PaymentMethod, number>();
  let total = 0;
  for (const e of expenses) {
    if (e.status === "VOIDED") continue;
    total += e.amountXof;
    byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + e.amountXof);
    byMethod.set(e.method, (byMethod.get(e.method) ?? 0) + e.amountXof);
  }
  return {
    rows: expenses.map((e) => ({ ...e, recordedByName: names.get(e.recordedById) ?? "—" })),
    totals: {
      total,
      byCategory: [...byCategory.entries()]
        .map(([name, amountXof]) => ({ name, amountXof }))
        .sort((a, b) => b.amountXof - a.amountXof),
      byMethod: [...byMethod.entries()].map(([method, amountXof]) => ({ method, amountXof })),
    },
  };
}

// --- Justificatifs ---------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EXPENSE = 5;

/**
 * Type RÉEL du fichier, d'après ses premiers octets : le type annoncé par le
 * navigateur (et l'extension) se falsifie trivialement.
 */
export function sniffMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp"; // RIFF....WEBP
  }
  return null;
}

/** Nom affiché et proposé au téléchargement : sans chemin ni caractère de contrôle. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120);
  return cleaned || "justificatif";
}

export async function addAttachment(tx: Tx, actor: Actor, expenseId: string, file: { name: string; bytes: Uint8Array }) {
  if (file.bytes.length === 0) throw new BusinessError("Le fichier est vide.", "file");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new BusinessError("Fichier trop volumineux : 5 Mo maximum.", "file");
  const mimeType = sniffMimeType(file.bytes);
  if (!mimeType) throw new BusinessError("Formats acceptés : photo (JPEG, PNG, WebP) ou PDF.", "file");

  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, status: true, _count: { select: { attachments: true } } },
  });
  if (!expense) throw new BusinessError("Dépense introuvable.");
  if (expense.status === "VOIDED") throw new BusinessError("Dépense annulée : aucun justificatif à ajouter.");
  if (expense._count.attachments >= MAX_ATTACHMENTS_PER_EXPENSE) {
    throw new BusinessError(`${MAX_ATTACHMENTS_PER_EXPENSE} justificatifs maximum par dépense.`, "file");
  }

  const attachment = await tx.expenseAttachment.create({
    data: {
      tenantId: actor.tenantId,
      expenseId,
      fileName: safeFileName(file.name),
      mimeType,
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      data: new Uint8Array(file.bytes),
      uploadedById: actor.userId,
    },
    select: { id: true, fileName: true, sizeBytes: true },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense.attachment.add",
    entityType: "expense",
    entityId: expenseId,
    after: { attachmentId: attachment.id, fileName: attachment.fileName, mimeType, sizeBytes: attachment.sizeBytes },
  });
  return attachment;
}

/** Retrait d'un fichier joint par erreur (tracé), tant que la dépense n'est pas annulée. */
export async function removeAttachment(tx: Tx, actor: Actor, attachmentId: string) {
  const attachment = await tx.expenseAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, fileName: true, sha256: true, expenseId: true, expense: { select: { status: true } } },
  });
  if (!attachment) throw new BusinessError("Justificatif introuvable.");
  if (attachment.expense.status === "VOIDED") throw new BusinessError("Dépense annulée : les justificatifs sont conservés.");
  await tx.expenseAttachment.delete({ where: { id: attachment.id } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "expense.attachment.remove",
    entityType: "expense",
    entityId: attachment.expenseId,
    before: { fileName: attachment.fileName, sha256: attachment.sha256 },
  });
}

export function loadAttachment(tx: Tx, attachmentId: string) {
  return tx.expenseAttachment.findUnique({
    where: { id: attachmentId },
    select: { fileName: true, mimeType: true, data: true },
  });
}
