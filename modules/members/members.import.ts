import * as z from "zod";
import { audit } from "@/lib/audit";
import { normalizeHeader, parseCsv } from "@/lib/csv";
import type { Tx } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { reserveMemberCodes, type Actor } from "@/modules/members/members.service";

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 1_000_000;

type Field = "firstName" | "lastName" | "phone" | "email";

/** En-têtes acceptés (après normalisation : minuscules, sans accents ni espaces). */
const HEADER_ALIASES: Record<string, Field> = {
  nom: "lastName",
  nomdefamille: "lastName",
  lastname: "lastName",
  prenom: "firstName",
  prenoms: "firstName",
  firstname: "firstName",
  telephone: "phone",
  tel: "phone",
  phone: "phone",
  mobile: "phone",
  contact: "phone",
  numero: "phone",
  email: "email",
  mail: "email",
  courriel: "email",
};

const REQUIRED: Field[] = ["lastName", "firstName", "phone"];

const FIELD_LABELS: Record<Field, string> = {
  lastName: "nom",
  firstName: "prénom",
  phone: "téléphone",
  email: "e-mail",
};

export type ImportRow = {
  line: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: "ok" | "duplicate" | "error";
  message?: string;
};

export type ImportAnalysis = {
  rows: ImportRow[];
  missingColumns: string[];
  truncated: boolean;
  counts: { ok: number; duplicate: number; error: number };
};

/**
 * Analyse PURE d'un fichier CSV (testable sans base) : correspondance des
 * colonnes, validation ligne par ligne, détection des doublons dans le
 * fichier et avec les adhérents existants (`existingPhones`).
 */
export function analyzeMemberCsv(text: string, existingPhones: Set<string>): ImportAnalysis {
  const [header = [], ...lines] = parseCsv(text);
  const columns = new Map<Field, number>();
  header.forEach((h, i) => {
    const field = HEADER_ALIASES[normalizeHeader(h)];
    if (field && !columns.has(field)) columns.set(field, i);
  });
  const missingColumns = REQUIRED.filter((f) => !columns.has(f)).map((f) => FIELD_LABELS[f]);
  if (missingColumns.length > 0) {
    return { rows: [], missingColumns, truncated: false, counts: { ok: 0, duplicate: 0, error: 0 } };
  }

  const cell = (row: string[], f: Field) => {
    const index = columns.get(f);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  const seen = new Set<string>();

  const rows = lines.slice(0, IMPORT_MAX_ROWS).map((row, index): ImportRow => {
    const base = {
      line: index + 2, // ligne 1 = en-tête, numérotation Excel
      firstName: cell(row, "firstName"),
      lastName: cell(row, "lastName"),
      phone: cell(row, "phone"),
      email: cell(row, "email").toLowerCase() || null,
    };
    const problems: string[] = [];
    if (!base.lastName) problems.push("nom manquant");
    if (!base.firstName) problems.push("prénom manquant");
    const phone = normalizePhone(base.phone);
    if (!phone) problems.push("téléphone invalide");
    if (base.email && !z.email().safeParse(base.email).success) problems.push("e-mail invalide");
    if (problems.length > 0 || !phone) return { ...base, status: "error", message: problems.join(", ") };

    if (existingPhones.has(phone)) {
      return { ...base, phone, status: "duplicate", message: "déjà inscrit dans la salle" };
    }
    if (seen.has(phone)) return { ...base, phone, status: "duplicate", message: "en double dans le fichier" };
    seen.add(phone);
    return { ...base, phone, status: "ok" };
  });

  const counts = { ok: 0, duplicate: 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, missingColumns: [], truncated: lines.length > IMPORT_MAX_ROWS, counts };
}

export async function loadExistingPhones(tx: Tx): Promise<Set<string>> {
  const members = await tx.member.findMany({ select: { phone: true } });
  return new Set(members.map((m) => m.phone));
}

/**
 * Importe les lignes valides. Les consentements ne sont PAS présumés :
 * ils restent à « non » tant que l'adhérent ne les a pas donnés.
 */
export async function importMembers(tx: Tx, actor: Actor, analysis: ImportAnalysis): Promise<number> {
  const valid = analysis.rows.filter((r) => r.status === "ok");
  if (valid.length === 0) return 0;

  const codes = await reserveMemberCodes(tx, actor.tenantId, valid.length);
  const { count } = await tx.member.createMany({
    data: valid.map((r, i) => ({
      tenantId: actor.tenantId,
      code: codes[i],
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      email: r.email,
      source: "IMPORT" as const,
      createdById: actor.userId,
    })),
    skipDuplicates: true, // filet de sécurité si un numéro a été inscrit entre-temps
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "member.import",
    entityType: "member",
    after: { imported: count, skipped: analysis.counts.duplicate + analysis.counts.error },
  });
  return count;
}
