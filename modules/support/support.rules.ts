import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  TenantRole,
} from "@/lib/generated/prisma/enums";

/**
 * Règles du support ZahDigit (pures, testées dans tests/unit/support-rules.test.ts).
 * Les mêmes garanties sont reprises par la base (migration 20270114080100) :
 * l'interface explique, la base interdit.
 */

export const SUPPORT_ACCESS_RULES = {
  /** Durée proposée par défaut et durée maximale d'un accès (contrainte SQL : 2 h). */
  defaultMinutes: 60,
  maxMinutes: 120,
  durations: [30, 60, 120] as const,
  /** Le support ne consulte jamais l'espace d'un adhérent (QR d'entrée, données personnelles). */
  allowedRoles: ["ADMIN", "MANAGER", "RECEPTIONIST", "COACH", "ACCOUNTANT"] as const satisfies readonly TenantRole[],
};

export const TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: "En attente du support",
  IN_PROGRESS: "Pris en charge",
  WAITING_CUSTOMER: "Réponse attendue",
  RESOLVED: "Résolu",
  CLOSED: "Clos",
};

export const TICKET_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  TECHNICAL: "Problème technique",
  BILLING: "Facturation ZAHFIT",
  ACCOUNT: "Comptes et accès",
  FEATURE_REQUEST: "Suggestion",
  OTHER: "Autre",
};

export const TICKET_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente (salle bloquée)",
};

/** Filtres de la liste ZahDigit : ce qui attend une action de l'équipe en premier. */
export const PLATFORM_TICKET_FILTERS = {
  "a-traiter": ["OPEN", "IN_PROGRESS"],
  "en-attente": ["WAITING_CUSTOMER"],
  resolus: ["RESOLVED", "CLOSED"],
} as const satisfies Record<string, readonly SupportTicketStatus[]>;
export type PlatformTicketFilter = keyof typeof PLATFORM_TICKET_FILTERS | "tous";

export const isClosed = (status: SupportTicketStatus) => status === "CLOSED";

/**
 * Statut après une réponse de la SALLE : un ticket qui attendait la salle
 * (ou proposé comme résolu) revient dans la file de ZahDigit.
 */
export function statusAfterTenantReply(status: SupportTicketStatus): SupportTicketStatus {
  return status === "WAITING_CUSTOMER" || status === "RESOLVED" ? "OPEN" : status;
}

/**
 * Statut après une réponse PUBLIQUE de ZahDigit, si l'agent n'en choisit
 * pas d'autre : la balle est dans le camp de la salle.
 */
export const DEFAULT_STATUS_AFTER_PLATFORM_REPLY: SupportTicketStatus = "WAITING_CUSTOMER";

/** Changements de statut que la salle peut faire elle-même (repris par un déclencheur SQL). */
export function tenantCanSetStatus(from: SupportTicketStatus, to: SupportTicketStatus): boolean {
  if (from === "CLOSED" || from === to) return false;
  return to === "CLOSED" || (to === "OPEN" && (from === "WAITING_CUSTOMER" || from === "RESOLVED"));
}

/** Un accès du support est en cours tant qu'il n'est ni terminé ni expiré. */
export function supportAccessActive(access: { endedAt: Date | null; expiresAt: Date }, now = new Date()) {
  return access.endedAt === null && access.expiresAt.getTime() > now.getTime();
}

/** Fin effective d'un accès : sa clôture manuelle, ou son expiration. */
export function supportAccessEnd(access: { endedAt: Date | null; expiresAt: Date }) {
  return access.endedAt && access.endedAt < access.expiresAt ? access.endedAt : access.expiresAt;
}

export const ticketRef = (n: number) => `#${n}`;
