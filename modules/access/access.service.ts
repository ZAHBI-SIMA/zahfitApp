import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { AccessMethod, AccessReason, MemberStatus } from "@/lib/generated/prisma/enums";
import { generateBadgeCode, tenantDayKey, tenantDayKeys } from "@/modules/access/keys";
import { evaluateAccess, localParts, type AccessDecision, type AccessSubscription } from "@/modules/access/rules";
import { badgeHash, dayOfWindow, parseCredential, qrWindowStatus, verifyQrSignature } from "@/modules/access/token";
import type { AccessSnapshot, OfflineAccessEvent, ScanResult } from "@/modules/access/types";
import { lockRow } from "@/modules/payments/payments.service";
import { readOpeningHours } from "@/modules/tenants/tenants.schema";

/**
 * Contrôle d'accès. Toutes les fonctions s'exécutent dans le contexte RLS
 * de la salle (withTenant) : un adhérent d'une autre salle est invisible.
 */

type Actor = { tenantId: string; userId: string | null };

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Le cache hors ligne ne garde que les abonnements récents ou en attente. */
const SNAPSHOT_HISTORY_DAYS = 31;
/** Fenêtre acceptée pour les passages synchronisés après une coupure. */
const OFFLINE_MAX_AGE_DAYS = 7;

const memberSelect = { id: true, code: true, firstName: true, lastName: true, photoUrl: true, status: true } as const;
type MemberRow = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  status: MemberStatus;
};

const subscriptionSelect = {
  id: true,
  memberId: true,
  status: true,
  startDate: true,
  endDate: true,
  planName: true,
  allowedDays: true,
  accessFrom: true,
  accessUntil: true,
  maxEntries: true,
} as const;

async function tenantRules(tx: Tx, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true, openingHours: true, antiPassbackMinutes: true },
  });
  return {
    timezone: t.timezone,
    // Sans horaires renseignés, aucune restriction (pas d'horaires « par défaut » imposés).
    openingHours: t.openingHours ? readOpeningHours(t.openingHours) : null,
    antiPassbackMinutes: t.antiPassbackMinutes,
  };
}

/** Abonnements, entrées consommées et dernière entrée de plusieurs adhérents. */
async function loadRights(tx: Tx, memberIds: string[], since: Date | null) {
  const subs = await tx.subscription.findMany({
    where: {
      memberId: { in: memberIds },
      ...(since ? { OR: [{ endDate: { gte: since } }, { status: { in: ["PENDING_PAYMENT", "FROZEN"] } }] } : {}),
    },
    select: subscriptionSelect,
    orderBy: { endDate: "desc" },
  });
  const used = await tx.accessLog.groupBy({
    by: ["subscriptionId"],
    where: { subscriptionId: { in: subs.map((s) => s.id) }, granted: true },
    _count: { _all: true },
  });
  const last = await tx.accessLog.groupBy({
    by: ["memberId"],
    where: { memberId: { in: memberIds }, granted: true },
    _max: { occurredAt: true },
  });
  const usedBySub = new Map(used.map((u) => [u.subscriptionId, u._count._all]));
  const lastByMember = new Map(last.map((l) => [l.memberId, l._max.occurredAt]));

  const rights = new Map<string, { subscriptions: AccessSubscription[]; lastGrantedAt: Date | null }>();
  for (const id of memberIds) rights.set(id, { subscriptions: [], lastGrantedAt: lastByMember.get(id) ?? null });
  for (const s of subs) {
    rights.get(s.memberId)!.subscriptions.push({
      id: s.id,
      status: s.status,
      startDate: isoDay(s.startDate),
      endDate: isoDay(s.endDate),
      planName: s.planName,
      allowedDays: s.allowedDays,
      accessFrom: s.accessFrom,
      accessUntil: s.accessUntil,
      maxEntries: s.maxEntries,
      entriesUsed: usedBySub.get(s.id) ?? 0,
    });
  }
  return rights;
}

type Identification = { method: AccessMethod; memberId: string | null; failure: AccessReason | null };

/** Qui est devant l'accueil ? Vérifie la signature du QR ou l'empreinte du badge. */
async function identify(tx: Tx, tenantId: string, raw: string, now: Date): Promise<Identification> {
  const credential = parseCredential(raw);
  const method: AccessMethod = credential?.kind === "badge" || /^\s*zb/i.test(raw) ? "BADGE" : "QR";
  if (!credential) return { method, memberId: null, failure: "INVALID_CODE" };

  if (credential.kind === "badge") {
    const member = await tx.member.findFirst({
      where: { badgeHash: await badgeHash(credential.code) },
      select: { id: true },
    });
    return member ? { method, memberId: member.id, failure: null } : { method, memberId: null, failure: "UNKNOWN_BADGE" };
  }

  const windowStatus = qrWindowStatus(credential.window, now.getTime());
  if (windowStatus === "future") return { method, memberId: null, failure: "INVALID_CODE" };
  // La signature d'abord : un QR forgé n'obtient jamais un motif plus précis que « non reconnu ».
  const valid = await verifyQrSignature(tenantDayKey(tenantId, dayOfWindow(credential.window)), credential);
  if (!valid) return { method, memberId: null, failure: "INVALID_CODE" };
  const member = await tx.member.findUnique({ where: { id: credential.memberId }, select: { id: true } });
  if (!member) return { method, memberId: null, failure: "INVALID_CODE" };
  return { method, memberId: member.id, failure: windowStatus === "expired" ? "EXPIRED_CODE" : null };
}

/**
 * `alreadyCounted` : le passage figure déjà dans entriesUsed (reprise d'une
 * demande déjà traitée) ; sinon une entrée autorisée consomme une unité.
 */
function toResult(
  decision: AccessDecision,
  method: AccessMethod,
  member: MemberRow | null,
  occurredAt: Date,
  antiPassbackMinutes: number,
  alreadyCounted = false,
): ScanResult {
  const s = decision.subscription;
  const consumed = decision.granted && !alreadyCounted ? 1 : 0;
  return {
    granted: decision.granted,
    reason: decision.reason,
    method,
    occurredAt: occurredAt.toISOString(),
    offline: false,
    member: member
      ? { id: member.id, code: member.code, name: `${member.firstName} ${member.lastName}`, photoUrl: member.photoUrl }
      : null,
    subscription: s
      ? {
          id: s.id,
          planName: s.planName,
          endDate: s.endDate,
          entriesLeft: s.maxEntries === null ? null : Math.max(0, s.maxEntries - s.entriesUsed - consumed),
        }
      : null,
    antiPassbackMinutes,
  };
}

/**
 * Scan à l'accueil : identifie, applique les règles, JOURNALISE (autorisé
 * comme refusé) et répond. La ligne de l'adhérent est verrouillée pendant
 * la décision : deux scans simultanés ne peuvent pas consommer deux fois
 * la dernière entrée du quota ni contourner l'anti-passback.
 *
 * `clientEventId` rend l'appel idempotent : si la réponse se perd (réseau
 * instable) et que l'appareil renvoie la même demande, le passage n'est
 * compté qu'une fois et la même réponse est rendue.
 */
export async function checkAccess(
  tx: Tx,
  actor: Actor,
  input: { credential: string; clientEventId?: string | null },
  now: Date = new Date(),
): Promise<ScanResult> {
  const rules = await tenantRules(tx, actor.tenantId);

  if (input.clientEventId) {
    const existing = await tx.accessLog.findUnique({
      where: { tenantId_clientEventId: { tenantId: actor.tenantId, clientEventId: input.clientEventId } },
      include: { member: { select: memberSelect } },
    });
    if (existing) {
      const rights = existing.memberId ? (await loadRights(tx, [existing.memberId], null)).get(existing.memberId) : null;
      const subscription = rights?.subscriptions.find((s) => s.id === existing.subscriptionId) ?? null;
      return toResult(
        { granted: existing.granted, reason: existing.reason, subscription },
        existing.method,
        existing.member,
        existing.occurredAt,
        rules.antiPassbackMinutes,
        true,
      );
    }
  }

  const who = await identify(tx, actor.tenantId, input.credential, now);
  let member: MemberRow | null = null;
  if (who.memberId) {
    await lockRow(tx, "members", who.memberId);
    member = await tx.member.findUnique({ where: { id: who.memberId }, select: memberSelect });
  }

  let decision: AccessDecision;
  if (who.failure || !member) {
    decision = { granted: false, reason: who.failure ?? "INVALID_CODE", subscription: null };
  } else {
    const rights = (await loadRights(tx, [member.id], null)).get(member.id)!;
    decision = evaluateAccess(member, rights.subscriptions, { now, ...rules, lastGrantedAt: rights.lastGrantedAt });
  }

  await tx.accessLog.create({
    data: {
      tenantId: actor.tenantId,
      memberId: member?.id ?? null,
      subscriptionId: decision.subscription?.id ?? null,
      method: who.method,
      granted: decision.granted,
      reason: decision.reason,
      scannedById: actor.userId,
      clientEventId: input.clientEventId ?? null,
      occurredAt: now,
    },
  });
  return toResult(decision, who.method, member, now, rules.antiPassbackMinutes);
}

// --- Mode hors ligne ---------------------------------------------------------

/**
 * Cache des droits pour l'écran de scan. Données minimales : ni téléphone,
 * ni e-mail, et l'empreinte des badges plutôt que leur code.
 */
export async function accessSnapshot(tx: Tx, tenantId: string, now: Date = new Date()): Promise<AccessSnapshot> {
  const rules = await tenantRules(tx, tenantId);
  const since = new Date(Date.parse(localParts(now, rules.timezone).date) - SNAPSHOT_HISTORY_DAYS * DAY_MS);
  const members = await tx.member.findMany({
    where: {
      status: { not: "ARCHIVED" },
      subscriptions: { some: { OR: [{ endDate: { gte: since } }, { status: { in: ["PENDING_PAYMENT", "FROZEN"] } }] } },
    },
    select: { ...memberSelect, badgeHash: true },
  });
  const rights = await loadRights(
    tx,
    members.map((m) => m.id),
    since,
  );
  return {
    tenantId,
    generatedAt: now.toISOString(),
    timezone: rules.timezone,
    openingHours: rules.openingHours,
    antiPassbackMinutes: rules.antiPassbackMinutes,
    dayKeys: tenantDayKeys(tenantId, now),
    members: members.map((m) => {
      const r = rights.get(m.id)!;
      return {
        id: m.id,
        code: m.code,
        name: `${m.firstName} ${m.lastName}`,
        photoUrl: m.photoUrl,
        status: m.status,
        badgeHash: m.badgeHash,
        lastGrantedAt: r.lastGrantedAt?.toISOString() ?? null,
        subscriptions: r.subscriptions,
      };
    }),
  };
}

/**
 * Enregistre les passages décidés hors ligne. Idempotent (clientEventId
 * unique par salle) : renvoyer deux fois la même file ne double rien.
 * Les décisions ne sont pas rejouées — la personne est déjà entrée —, mais
 * toute référence à un adhérent ou un abonnement d'une autre salle, ou une
 * date incohérente, est écartée.
 */
export async function syncOfflineEvents(tx: Tx, actor: Actor, events: OfflineAccessEvent[], now: Date = new Date()) {
  const memberIds = [...new Set(events.map((e) => e.memberId).filter((id): id is string => !!id))];
  const subscriptionIds = [...new Set(events.map((e) => e.subscriptionId).filter((id): id is string => !!id))];
  const knownMembers = new Set(
    (await tx.member.findMany({ where: { id: { in: memberIds } }, select: { id: true } })).map((m) => m.id),
  );
  const subOwner = new Map(
    (
      await tx.subscription.findMany({ where: { id: { in: subscriptionIds } }, select: { id: true, memberId: true } })
    ).map((s) => [s.id, s.memberId]),
  );
  const oldest = now.getTime() - OFFLINE_MAX_AGE_DAYS * DAY_MS;
  const latest = now.getTime() + 5 * 60_000;

  const rows = events.filter((e) => {
    const at = Date.parse(e.occurredAt);
    if (!(at >= oldest && at <= latest)) return false;
    if (e.memberId && !knownMembers.has(e.memberId)) return false;
    if (e.subscriptionId && subOwner.get(e.subscriptionId) !== e.memberId) return false;
    if (e.granted !== (e.reason === "GRANTED")) return false;
    return !e.granted || (e.memberId !== null && e.subscriptionId !== null);
  });

  const { count } = await tx.accessLog.createMany({
    data: rows.map((e) => ({
      tenantId: actor.tenantId,
      memberId: e.memberId,
      subscriptionId: e.subscriptionId,
      method: e.method,
      granted: e.granted,
      reason: e.reason,
      scannedById: actor.userId,
      offline: true,
      clientEventId: e.clientEventId,
      occurredAt: new Date(e.occurredAt),
    })),
    skipDuplicates: true,
  });
  return { received: events.length, inserted: count, rejected: events.length - rows.length };
}

// --- Badges physiques --------------------------------------------------------

/**
 * Émet (ou renouvelle) le badge d'un adhérent. Le code n'est renvoyé
 * qu'UNE fois, pour l'impression : la base n'en garde que l'empreinte.
 * Renouveler invalide immédiatement l'ancien badge (perte, vol).
 */
export async function issueBadge(tx: Tx, actor: Actor, memberId: string): Promise<{ code: string }> {
  const member = await tx.member.findUnique({ where: { id: memberId }, select: { status: true, badgeHash: true } });
  if (!member) throw new BusinessError("Adhérent introuvable.");
  if (member.status === "ARCHIVED") throw new BusinessError("Restaurez l'adhérent avant de lui remettre un badge.");

  const code = generateBadgeCode();
  await tx.member.update({
    where: { id: memberId },
    data: { badgeHash: await badgeHash(code), badgeHint: code.slice(-4), badgeIssuedAt: new Date() },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: member.badgeHash ? "member.badge.renew" : "member.badge.issue",
    entityType: "member",
    entityId: memberId,
    after: { hint: code.slice(-4) },
  });
  return { code };
}

export async function revokeBadge(tx: Tx, actor: Actor, memberId: string) {
  const member = await tx.member.findUnique({ where: { id: memberId }, select: { badgeHint: true } });
  if (!member?.badgeHint) throw new BusinessError("Cet adhérent n'a pas de badge actif.");
  await tx.member.update({ where: { id: memberId }, data: { badgeHash: null, badgeHint: null, badgeIssuedAt: null } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "member.badge.revoke",
    entityType: "member",
    entityId: memberId,
    before: { hint: member.badgeHint },
  });
}

// --- Réglages et fréquentation ------------------------------------------------

export async function updateAccessSettings(tx: Tx, actor: { tenantId: string; userId: string }, antiPassbackMinutes: number) {
  const before = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { antiPassbackMinutes: true } });
  await tx.tenant.update({ where: { id: actor.tenantId }, data: { antiPassbackMinutes } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.access.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    before,
    after: { antiPassbackMinutes },
  });
}

export function getAccessSettings(tx: Tx, tenantId: string) {
  return tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { antiPassbackMinutes: true } });
}

/** Fréquentation : jours récents, heures d'aujourd'hui, motifs de refus du jour. */
export async function accessOverview(tx: Tx, tenantId: string, now: Date = new Date(), days = 14) {
  const { timezone } = await tenantRules(tx, tenantId);
  const today = localParts(now, timezone).date;
  // Un jour de marge : le filtre sur l'index précède la conversion de fuseau.
  const since = new Date(Date.parse(today) - days * DAY_MS);

  const daily = await tx.$queryRaw<{ day: string; granted: number; denied: number; members: number }[]>`
    SELECT to_char((occurred_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE granted)::int AS granted,
           count(*) FILTER (WHERE NOT granted)::int AS denied,
           count(DISTINCT member_id) FILTER (WHERE granted)::int AS members
    FROM access_logs
    WHERE occurred_at >= ${since}
    GROUP BY 1 ORDER BY 1`;
  const hourly = await tx.$queryRaw<{ hour: number; n: number }[]>`
    SELECT extract(hour FROM occurred_at AT TIME ZONE ${timezone})::int AS hour, count(*)::int AS n
    FROM access_logs
    WHERE granted AND occurred_at >= ${since}
      AND (occurred_at AT TIME ZONE ${timezone})::date = ${today}::date
    GROUP BY 1`;
  const reasons = await tx.$queryRaw<{ reason: AccessReason; n: number }[]>`
    SELECT reason, count(*)::int AS n
    FROM access_logs
    WHERE NOT granted AND occurred_at >= ${since}
      AND (occurred_at AT TIME ZONE ${timezone})::date = ${today}::date
    GROUP BY 1 ORDER BY 2 DESC`;

  const byDay = new Map(daily.map((d) => [d.day, d]));
  const calendar = Array.from({ length: days }, (_, i) => isoDay(new Date(Date.parse(today) - (days - 1 - i) * DAY_MS)));
  const byHour = new Map(hourly.map((h) => [h.hour, h.n]));
  return {
    today,
    days: calendar.map((day) => byDay.get(day) ?? { day, granted: 0, denied: 0, members: 0 }),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, n: byHour.get(hour) ?? 0 })),
    reasons,
  };
}

export function listAccessLogs(tx: Tx, options: { granted?: boolean; take?: number } = {}) {
  return tx.accessLog.findMany({
    where: options.granted === undefined ? {} : { granted: options.granted },
    orderBy: { occurredAt: "desc" },
    take: options.take ?? 100,
    include: {
      member: { select: { id: true, code: true, firstName: true, lastName: true } },
      subscription: { select: { planName: true } },
    },
  });
}

/** Derniers passages d'un adhérent (fiche adhérent). */
export function memberAccessHistory(tx: Tx, memberId: string, take = 10) {
  return tx.accessLog.findMany({
    where: { memberId },
    orderBy: { occurredAt: "desc" },
    take,
    select: { id: true, occurredAt: true, granted: true, reason: true, method: true, offline: true },
  });
}
