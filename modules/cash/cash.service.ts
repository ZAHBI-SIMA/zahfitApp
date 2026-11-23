import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatXof } from "@/lib/format";
import type { CashMovementKind, TenantRole } from "@/lib/generated/prisma/enums";
import { checkbox, optionalText, requiredText } from "@/lib/validation";
import { lockRow } from "@/modules/payments/payments.service";

type Actor = { tenantId: string; userId: string | null };

/**
 * Caisse (espèces) : ouverture avec un fond compté, mouvements immuables
 * (encaissements, remboursements, dépenses, apports, retraits), clôture
 * avec comptage et écart, puis validation par le gérant.
 *
 * Garanties côté base (migration 20261210080100) : une seule caisse
 * ouverte par salle, mouvements seulement dans une caisse OUVERTE, signe
 * cohérent avec le type, théorique recalculé à la clôture, aucun retour
 * en arrière après clôture ou validation.
 */

// --- Montants saisis -----------------------------------------------------------

/** « 25 000 », « 25000 FCFA » → 25000. `allowZero` : un fond de caisse peut être vide. */
const cashAmount = (label: string, allowZero = false) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .transform((v) => v.replace(/[^\d]/g, ""))
    .refine((v) => v.length > 0, `${label} est obligatoire.`)
    .transform(Number)
    .refine((n) => Number.isInteger(n) && (allowZero ? n >= 0 : n > 0) && n <= 50_000_000, `${label} invalide.`);

export const openSessionSchema = z.object({ openingFloatXof: cashAmount("Le fond de caisse", true) });
export const manualMovementSchema = z.object({
  kind: z.enum(["DEPOSIT", "WITHDRAWAL"], { error: "Choisissez apport ou retrait." }),
  amountXof: cashAmount("Le montant"),
  label: requiredText("Le motif", 120),
});
export const closeSessionSchema = z.object({
  countedXof: cashAmount("Le montant compté", true),
  closingNote: optionalText(300),
});
export const validateSessionSchema = z.object({
  sessionId: z.uuid(),
  validationNote: optionalText(300),
});
export const cashSettingsSchema = z.object({ cashSessionRequired: checkbox });

// --- Lecture -----------------------------------------------------------------

export function openSession(tx: Tx) {
  return tx.cashSession.findFirst({ where: { status: "OPEN" } });
}

/** Espèces théoriquement présentes : fond + somme des mouvements. */
export async function sessionBalance(tx: Tx, session: { id: string; openingFloatXof: number }) {
  const { _sum } = await tx.cashMovement.aggregate({ where: { sessionId: session.id }, _sum: { amountXof: true } });
  return session.openingFloatXof + (_sum.amountXof ?? 0);
}

// --- Mouvements ----------------------------------------------------------------

/**
 * Enregistre un mouvement d'espèces dans la caisse ouverte, DANS la
 * transaction de l'opération (encaissement, remboursement, dépense) : si
 * l'un échoue, l'autre est annulé.
 *
 * Sans caisse ouverte : refusé si la salle l'exige, sinon le mouvement est
 * journalisé « hors caisse » (signalé au gérant). Il n'est pas rattaché à la
 * caisse suivante : le fond compté à l'ouverture l'inclurait deux fois.
 */
export async function recordCashMovement(
  tx: Tx,
  actor: Actor,
  input: { kind: CashMovementKind; amountXof: number; label: string; paymentId?: string; expenseId?: string },
) {
  const session = await openSession(tx);
  if (session) {
    await lockRow(tx, "cash_sessions", session.id); // la clôture attend : le théorique reste juste
    if (input.amountXof < 0) {
      const balance = await sessionBalance(tx, session);
      if (balance + input.amountXof < 0) {
        throw new BusinessError(`La caisse ne contient que ${formatXof(balance)} : sortie de ${formatXof(-input.amountXof)} impossible.`);
      }
    }
  } else {
    const { cashSessionRequired } = await tx.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { cashSessionRequired: true },
    });
    if (cashSessionRequired) throw new BusinessError("Ouvrez la caisse avant toute opération en espèces.");
  }
  return tx.cashMovement.create({
    data: {
      tenantId: actor.tenantId,
      sessionId: session?.id ?? null,
      kind: input.kind,
      amountXof: input.amountXof,
      label: input.label.slice(0, 200),
      paymentId: input.paymentId,
      expenseId: input.expenseId,
      createdById: actor.userId,
    },
  });
}

/** Apport (monnaie) ou retrait (remise en banque) : toujours dans une caisse ouverte. */
export async function addManualMovement(tx: Tx, actor: Actor, input: z.infer<typeof manualMovementSchema>) {
  if (!(await openSession(tx))) throw new BusinessError("Aucune caisse ouverte.");
  const movement = await recordCashMovement(tx, actor, {
    kind: input.kind,
    amountXof: input.kind === "WITHDRAWAL" ? -input.amountXof : input.amountXof,
    label: input.label,
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "cash.movement",
    entityType: "cash_movement",
    entityId: movement.id,
    after: { kind: input.kind, amountXof: movement.amountXof, label: input.label, sessionId: movement.sessionId },
  });
  return movement;
}

// --- Cycle de vie ---------------------------------------------------------------

export async function openCashSession(tx: Tx, actor: Actor & { userId: string }, input: z.infer<typeof openSessionSchema>) {
  if (await openSession(tx)) throw new BusinessError("Une caisse est déjà ouverte : clôturez-la d'abord.");
  const session = await tx.cashSession.create({
    data: { tenantId: actor.tenantId, openedById: actor.userId, openingFloatXof: input.openingFloatXof },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "cash.open",
    entityType: "cash_session",
    entityId: session.id,
    after: { openingFloatXof: input.openingFloatXof },
  });
  return session;
}

/**
 * Clôture : la caisse est verrouillée (plus aucun mouvement ne peut s'y
 * glisser), le théorique est figé, l'écart calculé. Un écart doit être
 * expliqué : c'est ce que le gérant examinera avant de valider.
 */
export async function closeCashSession(tx: Tx, actor: Actor & { userId: string }, input: z.infer<typeof closeSessionSchema>) {
  const current = await openSession(tx);
  if (!current) throw new BusinessError("Aucune caisse ouverte.");
  await lockRow(tx, "cash_sessions", current.id);
  const expectedXof = await sessionBalance(tx, current);
  const differenceXof = input.countedXof - expectedXof;
  if (differenceXof !== 0 && !input.closingNote) {
    throw new BusinessError(
      `Écart de ${formatXof(differenceXof)} (${differenceXof > 0 ? "excédent" : "manquant"}) : expliquez-le avant de clôturer.`,
      "closingNote",
    );
  }
  const session = await tx.cashSession.update({
    where: { id: current.id },
    data: {
      status: "CLOSED",
      closedById: actor.userId,
      closedAt: new Date(),
      expectedXof,
      countedXof: input.countedXof,
      differenceXof,
      closingNote: input.closingNote,
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "cash.close",
    entityType: "cash_session",
    entityId: session.id,
    after: { expectedXof, countedXof: input.countedXof, differenceXof, closingNote: input.closingNote },
  });
  return session;
}

/**
 * Validation par le gérant. Séparation des tâches : on ne valide pas sa
 * propre clôture, sauf le propriétaire (ADMIN), seul dans une petite salle.
 */
export async function validateCashSession(
  tx: Tx,
  actor: Actor & { userId: string },
  role: TenantRole,
  input: z.infer<typeof validateSessionSchema>,
) {
  await lockRow(tx, "cash_sessions", input.sessionId);
  const session = await tx.cashSession.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new BusinessError("Caisse introuvable.");
  if (session.status === "OPEN") throw new BusinessError("Cette caisse n'est pas encore clôturée.");
  if (session.status === "VALIDATED") throw new BusinessError("Cette caisse est déjà validée.");
  if (session.closedById === actor.userId && role !== "ADMIN") {
    throw new BusinessError("Vous avez clôturé cette caisse : un autre responsable doit la valider.");
  }
  if (session.differenceXof && !input.validationNote) {
    throw new BusinessError("Caisse avec écart : indiquez la suite donnée (retenue, erreur retrouvée…).", "validationNote");
  }
  const validated = await tx.cashSession.update({
    where: { id: session.id },
    data: { status: "VALIDATED", validatedById: actor.userId, validatedAt: new Date(), validationNote: input.validationNote },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "cash.validate",
    entityType: "cash_session",
    entityId: session.id,
    after: { differenceXof: session.differenceXof, validationNote: input.validationNote },
  });
  return validated;
}

export async function updateCashSettings(tx: Tx, actor: Actor, input: z.infer<typeof cashSettingsSchema>) {
  await tx.tenant.update({ where: { id: actor.tenantId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.cash.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: input,
  });
}

// --- Rapports ------------------------------------------------------------------

export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = {
  PAYMENT: "Encaissement",
  REFUND: "Remboursement",
  EXPENSE: "Dépense",
  EXPENSE_VOID: "Dépense annulée",
  DEPOSIT: "Apport",
  WITHDRAWAL: "Retrait",
};

async function userNames(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return (id: string | null | undefined) => (id ? (names.get(id) ?? "—") : "—");
}

/** Caisse ouverte : solde, mouvements, total par type. */
export async function currentCashView(tx: Tx) {
  const session = await openSession(tx);
  if (!session) return null;
  const movements = await tx.cashMovement.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "desc" } });
  const name = await userNames(tx, [session.openedById, ...movements.map((m) => m.createdById)]);
  return {
    session: { ...session, openedByName: name(session.openedById) },
    balance: session.openingFloatXof + movements.reduce((s, m) => s + m.amountXof, 0),
    movements: movements.map((m) => ({ ...m, createdByName: name(m.createdById) })),
  };
}

export async function listCashSessions(tx: Tx, take = 30) {
  const sessions = await tx.cashSession.findMany({
    where: { status: { not: "OPEN" } },
    orderBy: { openedAt: "desc" },
    take,
  });
  const name = await userNames(tx, sessions.flatMap((s) => [s.openedById, s.closedById, s.validatedById]));
  return sessions.map((s) => ({
    ...s,
    openedByName: name(s.openedById),
    closedByName: name(s.closedById),
    validatedByName: name(s.validatedById),
  }));
}

/** Z de caisse : tout ce qu'il faut pour le contrôle et le PDF. */
export async function cashSessionReport(tx: Tx, sessionId: string) {
  const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  const movements = await tx.cashMovement.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: { payment: { select: { receipt: { select: { number: true } } } } },
  });
  const name = await userNames(tx, [
    session.openedById,
    session.closedById,
    session.validatedById,
    ...movements.map((m) => m.createdById),
  ]);
  const byKind = new Map<CashMovementKind, { count: number; amountXof: number }>();
  for (const m of movements) {
    const entry = byKind.get(m.kind) ?? { count: 0, amountXof: 0 };
    entry.count++;
    entry.amountXof += m.amountXof;
    byKind.set(m.kind, entry);
  }
  return {
    session: {
      ...session,
      openedByName: name(session.openedById),
      closedByName: name(session.closedById),
      validatedByName: name(session.validatedById),
    },
    movements: movements.map((m) => ({ ...m, createdByName: name(m.createdById), receiptNumber: m.payment?.receipt?.number ?? null })),
    byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
    balance: session.openingFloatXof + movements.reduce((s, m) => s + m.amountXof, 0),
  };
}

export type CashSessionReport = NonNullable<Awaited<ReturnType<typeof cashSessionReport>>>;

/** Espèces encaissées sans caisse ouverte (mode souple) : à régulariser. */
export async function outsideSessionMovements(tx: Tx, since: Date) {
  return tx.cashMovement.findMany({
    where: { sessionId: null, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Mouvements d'une période (export comptable). */
export async function listCashMovements(tx: Tx, range: { from: Date; to: Date }) {
  const movements = await tx.cashMovement.findMany({
    where: { createdAt: { gte: range.from, lt: range.to } },
    orderBy: { createdAt: "asc" },
    include: { payment: { select: { receipt: { select: { number: true } } } } },
  });
  const name = await userNames(tx, movements.map((m) => m.createdById));
  return movements.map((m) => ({ ...m, createdByName: name(m.createdById), receiptNumber: m.payment?.receipt?.number ?? null }));
}
