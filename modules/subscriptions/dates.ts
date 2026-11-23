import type { DurationUnit, SubscriptionStatus } from "@/lib/generated/prisma/enums";

/**
 * Calcul des dates d'abonnement — fonctions PURES (aucune base, aucune
 * horloge cachée : « aujourd'hui » est toujours passé en paramètre).
 *
 * Conventions :
 *  - une date calendaire est une Date à minuit UTC ; Africa/Abidjan = UTC+0
 *    sans heure d'été, donc pas de décalage possible ;
 *  - la date de fin est INCLUSE : un abonnement d'1 jour commence et finit le même jour.
 */

const DAY_MS = 86_400_000;

export function toCalendarDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const todayCalendar = (now: Date = new Date()) => toCalendarDate(now);

/** « 2027-01-31 » → Date, ou null si la chaîne n'est pas une vraie date. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
/** Nombre de jours de `from` à `to` (négatif si `to` est avant). */
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);
const maxDate = (a: Date, b: Date) => (a > b ? a : b);

function addMonthsClamped(start: Date, months: number): { date: Date; clamped: boolean } {
  const totalMonth = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(totalMonth / 12);
  const month = ((totalMonth % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = start.getUTCDate();
  return { date: new Date(Date.UTC(year, month, Math.min(day, daysInTarget))), clamped: day > daysInTarget };
}

/**
 * Date de fin (incluse) d'un abonnement.
 *  - jours / semaines : début + durée − 1 jour ;
 *  - mois / années : même quantième le mois suivant − 1 jour
 *    (15 janv. → 14 févr.) ; si ce quantième n'existe pas dans le mois
 *    d'arrivée, l'abonnement finit le dernier jour de ce mois
 *    (31 janv. → 28 ou 29 févr. ; 29 févr. + 1 an → 28 févr.).
 */
export function computeEndDate(start: Date, value: number, unit: DurationUnit): Date {
  switch (unit) {
    case "DAY":
      return addDays(start, value - 1);
    case "WEEK":
      return addDays(start, value * 7 - 1);
    case "MONTH":
    case "YEAR": {
      const { date, clamped } = addMonthsClamped(start, unit === "YEAR" ? value * 12 : value);
      return clamped ? date : addDays(date, -1);
    }
  }
}

/**
 * Début d'un renouvellement : le lendemain de la fin en cours si
 * l'abonnement court encore (aucun jour perdu en renouvelant tôt), sinon
 * aujourd'hui (pas de rattrapage rétroactif après une interruption).
 */
export function renewalStartDate(currentEnd: Date | null, today: Date): Date {
  return currentEnd && currentEnd >= today ? addDays(currentEnd, 1) : today;
}

export type EffectiveStatus = SubscriptionStatus | "UPCOMING";

/** Statut réel à une date donnée (un ACTIVE dont la fin est passée est expiré). */
export function effectiveStatus(
  sub: { status: SubscriptionStatus; startDate: Date; endDate: Date },
  today: Date,
): EffectiveStatus {
  if (sub.status !== "ACTIVE") return sub.status;
  if (sub.endDate < today) return "EXPIRED";
  if (sub.startDate > today) return "UPCOMING";
  return "ACTIVE";
}

/** Jours restants (aujourd'hui inclus) d'un abonnement en cours ou à venir. */
export function remainingDays(sub: { startDate: Date; endDate: Date }, today: Date): number {
  return Math.max(0, daysBetween(maxDate(today, sub.startDate), sub.endDate) + 1);
}

export function overlaps(a: { startDate: Date; endDate: Date }, b: { startDate: Date; endDate: Date }) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export const freezeAllowance = (maxFreezeDays: number, frozenDays: number) => Math.max(0, maxFreezeDays - frozenDays);

/**
 * Reprise après un gel : la fin est repoussée du nombre de jours gelés,
 * dans la limite des jours de gel autorisés par la formule. Les jours
 * au-delà du plafond (`overflow`) ne sont pas rendus.
 */
export function computeUnfreeze(
  sub: { endDate: Date; frozenSince: Date; frozenDays: number; maxFreezeDays: number },
  today: Date,
) {
  const elapsed = Math.max(0, daysBetween(sub.frozenSince, today));
  const credited = Math.min(elapsed, freezeAllowance(sub.maxFreezeDays, sub.frozenDays));
  return {
    newEndDate: addDays(sub.endDate, credited),
    frozenDays: sub.frozenDays + credited,
    credited,
    overflow: elapsed - credited,
  };
}
