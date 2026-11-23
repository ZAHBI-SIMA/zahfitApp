import type { AccessReason, MemberStatus, SubscriptionStatus } from "@/lib/generated/prisma/enums";

/**
 * Règles d'accès — fonctions PURES et ISOMORPHES : le serveur (scan en
 * ligne) et l'écran de scan (hors ligne) appliquent exactement les mêmes.
 * « Maintenant » est toujours passé en paramètre.
 */

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

export type AccessSubscription = {
  id: string;
  status: SubscriptionStatus;
  /** Dates calendaires « AAAA-MM-JJ » (fin incluse) */
  startDate: string;
  endDate: string;
  planName: string;
  allowedDays: number[];
  accessFrom: string | null;
  accessUntil: string | null;
  maxEntries: number | null;
  /** Entrées déjà autorisées sur cet abonnement */
  entriesUsed: number;
};

export type AccessRulesContext = {
  now: Date;
  timezone: string;
  /** null = aucune restriction d'horaires d'ouverture configurée */
  openingHours: Record<string, string | null> | null;
  antiPassbackMinutes: number;
  lastGrantedAt: Date | null;
};

export type AccessDecision = {
  granted: boolean;
  reason: AccessReason;
  /** Abonnement concerné (celui qui a autorisé, ou qui explique le refus) */
  subscription: AccessSubscription | null;
};

/** Date, jour de semaine (1 = lundi) et heure « HH:MM » dans le fuseau de la salle. */
export function localParts(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, time: `${parts.hour}:${parts.minute}` };
}

/** Début inclus, fin exclue : « 06:00-22:00 » refuse à 22:00 pile. */
const inRange = (time: string, from: string, until: string) => time >= from && time < until;

/** Ordre de priorité pour expliquer un refus quand aucun abonnement n'est en cours. */
const NO_ACTIVE_PRIORITY: { match: (s: AccessSubscription, today: string) => boolean; reason: AccessReason }[] = [
  { match: (s) => s.status === "FROZEN", reason: "SUBSCRIPTION_FROZEN" },
  { match: (s, today) => s.status === "ACTIVE" && s.startDate > today, reason: "NOT_STARTED" },
  { match: (s) => s.status === "PENDING_PAYMENT", reason: "PAYMENT_PENDING" },
  {
    match: (s, today) => s.status === "EXPIRED" || (s.status === "ACTIVE" && s.endDate < today),
    reason: "SUBSCRIPTION_EXPIRED",
  },
  { match: (s) => s.status === "CANCELLED", reason: "SUBSCRIPTION_CANCELLED" },
];

export function evaluateAccess(
  member: { status: MemberStatus },
  subscriptions: AccessSubscription[],
  ctx: AccessRulesContext,
): AccessDecision {
  const deny = (reason: AccessReason, subscription: AccessSubscription | null = null): AccessDecision => ({
    granted: false,
    reason,
    subscription,
  });
  if (member.status === "ARCHIVED") return deny("MEMBER_ARCHIVED");
  if (member.status === "SUSPENDED") return deny("MEMBER_SUSPENDED");

  const local = localParts(ctx.now, ctx.timezone);
  const current = subscriptions.find((s) => s.status === "ACTIVE" && s.startDate <= local.date && local.date <= s.endDate);
  if (!current) {
    for (const rule of NO_ACTIVE_PRIORITY) {
      const found = subscriptions.find((s) => rule.match(s, local.date));
      if (found) return deny(rule.reason, found);
    }
    return deny("NO_SUBSCRIPTION");
  }

  if (current.allowedDays.length > 0 && !current.allowedDays.includes(local.weekday)) {
    return deny("DAY_NOT_ALLOWED", current);
  }
  if (ctx.openingHours) {
    const hours = ctx.openingHours[DAY_KEYS[local.weekday - 1]];
    if (!hours) return deny("GYM_CLOSED", current);
    const [from, until] = hours.split("-");
    if (from && until && !inRange(local.time, from, until)) return deny("OUTSIDE_HOURS", current);
  }
  if (current.accessFrom && current.accessUntil && !inRange(local.time, current.accessFrom, current.accessUntil)) {
    return deny("OUTSIDE_HOURS", current);
  }
  if (current.maxEntries !== null && current.entriesUsed >= current.maxEntries) {
    return deny("QUOTA_REACHED", current);
  }
  if (
    ctx.antiPassbackMinutes > 0 &&
    ctx.lastGrantedAt &&
    ctx.now.getTime() - ctx.lastGrantedAt.getTime() < ctx.antiPassbackMinutes * 60_000
  ) {
    return deny("PASSBACK", current);
  }
  return { granted: true, reason: "GRANTED", subscription: current };
}

/** Entrées restantes après cette décision (null = illimité). */
export function entriesLeft(decision: AccessDecision): number | null {
  const s = decision.subscription;
  if (!s || s.maxEntries === null) return null;
  return Math.max(0, s.maxEntries - s.entriesUsed - (decision.granted ? 1 : 0));
}
