import type { AccessMethod, AccessReason, MemberStatus } from "@/lib/generated/prisma/enums";
import type { AccessSubscription } from "@/modules/access/rules";

/** Réponse d'un scan, affichée en vert ou rouge à l'accueil. */
export type ScanResult = {
  granted: boolean;
  reason: AccessReason;
  method: AccessMethod;
  occurredAt: string;
  /** Décision prise par l'appareil sans réseau (synchronisée plus tard) */
  offline: boolean;
  member: { id: string; code: string; name: string; photoUrl: string | null } | null;
  subscription: { id: string; planName: string; endDate: string; entriesLeft: number | null } | null;
  antiPassbackMinutes: number;
};

/** Droits d'un adhérent, tels que mis en cache par l'écran de scan. */
export type SnapshotMember = {
  id: string;
  code: string;
  name: string;
  photoUrl: string | null;
  status: MemberStatus;
  badgeHash: string | null;
  lastGrantedAt: string | null;
  subscriptions: AccessSubscription[];
};

/** Cache hors ligne de l'écran de scan (une salle, valable deux jours au plus). */
export type AccessSnapshot = {
  tenantId: string;
  generatedAt: string;
  timezone: string;
  openingHours: Record<string, string | null> | null;
  antiPassbackMinutes: number;
  /** Clés du jour de la salle (aujourd'hui et demain) */
  dayKeys: Record<string, string>;
  members: SnapshotMember[];
};

/** Passage décidé hors ligne, en attente d'envoi au serveur. */
export type OfflineAccessEvent = {
  clientEventId: string;
  memberId: string | null;
  subscriptionId: string | null;
  method: AccessMethod;
  granted: boolean;
  reason: AccessReason;
  occurredAt: string;
};
