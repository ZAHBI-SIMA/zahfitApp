"use client";

import type { AccessMethod, AccessReason } from "@/lib/generated/prisma/enums";
import { evaluateAccess, type AccessDecision } from "@/modules/access/rules";
import { badgeHash, dayOfWindow, parseCredential, qrWindowStatus, verifyQrSignature } from "@/modules/access/token";
import type { AccessSnapshot, OfflineAccessEvent, ScanResult, SnapshotMember } from "@/modules/access/types";

/**
 * Mode hors ligne de l'écran de scan : cache des droits + file d'attente,
 * dans le localStorage de l'appareil (une entrée par salle). Les décisions
 * utilisent les MÊMES règles que le serveur (modules/access/rules.ts).
 *
 * Limites assumées : le cache date du dernier rafraîchissement (au plus
 * 10 minutes en marche normale) ; un abonnement payé pendant la coupure
 * n'est connu qu'au retour du réseau.
 */

const snapshotKey = (tenantId: string) => `zf_access_snapshot:${tenantId}`;
const queueKey = (tenantId: string) => `zf_access_queue:${tenantId}`;
const MAX_QUEUE = 5000;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage plein ou bloqué (navigation privée) : le mode hors ligne est simplement indisponible.
  }
}

export const loadSnapshot = (tenantId: string) => read<AccessSnapshot>(snapshotKey(tenantId));
export const saveSnapshot = (snapshot: AccessSnapshot) => write(snapshotKey(snapshot.tenantId), snapshot);
export const loadQueue = (tenantId: string) => read<OfflineAccessEvent[]>(queueKey(tenantId)) ?? [];

export function enqueue(tenantId: string, event: OfflineAccessEvent) {
  write(queueKey(tenantId), [...loadQueue(tenantId), event].slice(-MAX_QUEUE));
}

/** Retire de la file les passages que le serveur a bien reçus. */
export function dequeue(tenantId: string, sentIds: Set<string>) {
  write(
    queueKey(tenantId),
    loadQueue(tenantId).filter((e) => !sentIds.has(e.clientEventId)),
  );
}

/** Le passage est compté dans le cache, pour que l'anti-passback et le quota tiennent hors ligne. */
function recordGranted(snapshot: AccessSnapshot, member: SnapshotMember, subscriptionId: string | undefined, at: Date) {
  member.lastGrantedAt = at.toISOString();
  const sub = member.subscriptions.find((s) => s.id === subscriptionId);
  if (sub) sub.entriesUsed += 1;
  saveSnapshot(snapshot);
}

/**
 * Entrée accordée EN LIGNE : on la reporte aussi dans le cache. Sinon, si le
 * réseau tombe juste après, le cache (pris avant ce passage) laisserait
 * rentrer une seconde fois le même badge.
 */
export function noteOnlineGrant(tenantId: string, result: ScanResult) {
  const snapshot = loadSnapshot(tenantId);
  const member = snapshot?.members.find((m) => m.id === result.member?.id);
  if (snapshot && member) recordGranted(snapshot, member, result.subscription?.id, new Date(result.occurredAt));
}

type OfflineIdentification = {
  method: AccessMethod;
  memberId: string | null;
  member: SnapshotMember | null;
  failure: AccessReason | null;
};

async function identifyOffline(snapshot: AccessSnapshot, raw: string, now: Date): Promise<OfflineIdentification> {
  const credential = parseCredential(raw);
  const method: AccessMethod = credential?.kind === "badge" || /^\s*zb/i.test(raw) ? "BADGE" : "QR";
  if (!credential) return { method, memberId: null, member: null, failure: "INVALID_CODE" };

  if (credential.kind === "badge") {
    const hash = await badgeHash(credential.code);
    const member = snapshot.members.find((m) => m.badgeHash === hash) ?? null;
    return { method, memberId: member?.id ?? null, member, failure: member ? null : "UNKNOWN_BADGE" };
  }

  const windowStatus = qrWindowStatus(credential.window, now.getTime());
  const dayKey = snapshot.dayKeys[dayOfWindow(credential.window)];
  if (windowStatus === "future" || !dayKey || !(await verifyQrSignature(dayKey, credential))) {
    return { method, memberId: null, member: null, failure: "INVALID_CODE" };
  }
  // Signature valide = adhérent de la salle ; absent du cache = aucun abonnement récent.
  const member = snapshot.members.find((m) => m.id === credential.memberId) ?? null;
  const failure: AccessReason | null = windowStatus === "expired" ? "EXPIRED_CODE" : member ? null : "NO_SUBSCRIPTION";
  return { method, memberId: credential.memberId, member, failure };
}

/** Décision locale + passage à mettre en file (même identifiant que la tentative en ligne). */
export async function decideOffline(
  snapshot: AccessSnapshot,
  raw: string,
  clientEventId: string,
  now: Date = new Date(),
): Promise<{ result: ScanResult; event: OfflineAccessEvent }> {
  const who = await identifyOffline(snapshot, raw, now);
  const member = who.member;
  const decision: AccessDecision =
    who.failure || !member
      ? { granted: false, reason: who.failure ?? "INVALID_CODE", subscription: null }
      : evaluateAccess(member, member.subscriptions, {
          now,
          timezone: snapshot.timezone,
          openingHours: snapshot.openingHours,
          antiPassbackMinutes: snapshot.antiPassbackMinutes,
          lastGrantedAt: member.lastGrantedAt ? new Date(member.lastGrantedAt) : null,
        });

  const s = decision.subscription;
  const result: ScanResult = {
    granted: decision.granted,
    reason: decision.reason,
    method: who.method,
    occurredAt: now.toISOString(),
    offline: true,
    member: member ? { id: member.id, code: member.code, name: member.name, photoUrl: member.photoUrl } : null,
    subscription: s
      ? {
          id: s.id,
          planName: s.planName,
          endDate: s.endDate,
          entriesLeft:
            s.maxEntries === null ? null : Math.max(0, s.maxEntries - s.entriesUsed - (decision.granted ? 1 : 0)),
        }
      : null,
    antiPassbackMinutes: snapshot.antiPassbackMinutes,
  };
  if (decision.granted && member) recordGranted(snapshot, member, s?.id, now);

  return {
    result,
    event: {
      clientEventId,
      memberId: who.memberId,
      subscriptionId: s?.id ?? null,
      method: who.method,
      granted: decision.granted,
      reason: decision.reason,
      occurredAt: result.occurredAt,
    },
  };
}
