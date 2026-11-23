/**
 * Planning des cours — fonctions PURES (aucune base, aucune horloge cachée).
 * Dates calendaires « AAAA-MM-JJ », heures locales de la salle « HH:MM ».
 */

export const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const DAY_NAMES: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

/** Combien de jours de séances sont générés à l'avance. */
export const HORIZON_DAYS = 56;

const DAY_MS = 86_400_000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RANGE_RE = /^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export const isTime = (v: string) => TIME_RE.test(v);
export const addDaysIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** 1 = lundi … 7 = dimanche, pour une date calendaire. */
export const weekdayOf = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
/** Lundi de la semaine qui contient cette date. */
export const weekStart = (iso: string) => addDaysIso(iso, 1 - weekdayOf(iso));

export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const fromMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Une séance ne déborde pas sur le lendemain (fin à minuit au plus tard). */
export const fitsInDay = (startTime: string, durationMinutes: number) =>
  toMinutes(startTime) + durationMinutes <= 24 * 60;

/**
 * Jours d'un cours régulier compris dans [from, to] (bornes incluses),
 * limités à sa période de validité [startsOn, endsOn].
 */
export function occurrenceDates(
  series: { weekday: number; startsOn: string; endsOn: string | null },
  from: string,
  to: string,
): string[] {
  const start = from > series.startsOn ? from : series.startsOn;
  const end = series.endsOn && series.endsOn < to ? series.endsOn : to;
  if (start > end) return [];
  const dates: string[] = [];
  let day = addDaysIso(start, (series.weekday - weekdayOf(start) + 7) % 7);
  while (day <= end) {
    dates.push(day);
    day = addDaysIso(day, 7);
  }
  return dates;
}

// --- Disponibilités des coachs ---------------------------------------------

export type Availability = Record<DayKey, string[]>;

export const emptyAvailability = (): Availability =>
  Object.fromEntries(DAY_KEYS.map((d) => [d, []])) as unknown as Availability;

/** Lecture tolérante du JSON stocké ; null = disponibilités non renseignées. */
export function readAvailability(value: unknown): Availability | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const result = emptyAvailability();
  for (const day of DAY_KEYS) {
    const ranges = raw[day];
    if (Array.isArray(ranges)) {
      result[day] = ranges.filter((r): r is string => typeof r === "string" && RANGE_RE.test(r));
    }
  }
  return result;
}

/**
 * « 06:00-12:00, 16:00 - 20:00 » → ["06:00-12:00", "16:00-20:00"].
 * Renvoie une erreur lisible si un créneau est mal formé ou inversé.
 */
export function parseRanges(text: string): { ranges: string[]; error?: string } {
  const ranges = text
    .split(/[,;]/)
    .map((r) => r.replace(/\s+/g, ""))
    .filter(Boolean);
  for (const r of ranges) {
    if (!RANGE_RE.test(r)) return { ranges: [], error: `Créneau « ${r} » invalide (format 06:00-12:00).` };
    const [from, to] = r.split("-");
    if (toMinutes(from) >= toMinutes(to)) {
      return { ranges: [], error: `Créneau « ${r} » : le début doit précéder la fin.` };
    }
  }
  return { ranges };
}

/** Le coach est-il disponible sur tout le créneau ? (null = aucune contrainte déclarée) */
export function isAvailable(
  availability: Availability | null,
  weekday: number,
  startTime: string,
  durationMinutes: number,
) {
  if (!availability) return true;
  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  return availability[DAY_KEYS[weekday - 1]].some((range) => {
    const [from, to] = range.split("-");
    return toMinutes(from) <= start && end <= toMinutes(to);
  });
}
