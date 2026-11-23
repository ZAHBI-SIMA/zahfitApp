import type {
  DurationUnit,
  MemberSource,
  MemberStatus,
  PaymentMethod,
  PaymentStatus,
  TenantRole,
  TenantStatus,
} from "@/lib/generated/prisma/enums";

export const DURATION_UNIT_LABELS: Record<DurationUnit, [singulier: string, pluriel: string]> = {
  DAY: ["jour", "jours"],
  WEEK: ["semaine", "semaines"],
  MONTH: ["mois", "mois"],
  YEAR: ["an", "ans"],
};

export const formatDuration = (value: number, unit: DurationUnit) =>
  `${value} ${DURATION_UNIT_LABELS[unit][value > 1 ? 1 : 0]}`;

/** Statut « réel » d'un abonnement (voir modules/subscriptions/dates.ts). */
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "En attente de paiement",
  ACTIVE: "En cours",
  UPCOMING: "À venir",
  FROZEN: "Suspendu",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile Money",
  TRANSFER: "Virement",
  CARD: "Carte bancaire",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "En attente",
  SUCCEEDED: "Confirmé",
  FAILED: "Échoué",
  EXPIRED: "Expiré",
  REFUNDED: "Remboursé",
};

export const WEEKDAY_LABELS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

export const ROLE_LABELS: Record<TenantRole, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Gérant",
  RECEPTIONIST: "Réceptionniste",
  COACH: "Coach",
  ACCOUNTANT: "Comptable",
  MEMBER: "Adhérent",
};

/** Rôles attribuables au personnel (l'adhérent a son propre parcours). */
export const STAFF_ROLES = ["ADMIN", "MANAGER", "RECEPTIONIST", "COACH", "ACCOUNTANT"] as const satisfies readonly TenantRole[];

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  ARCHIVED: "Archivé",
};

export const MEMBER_SOURCE_LABELS: Record<MemberSource, string> = {
  RECEPTION: "Inscrit à l'accueil",
  ONLINE: "Inscrit en ligne",
  IMPORT: "Importé",
};

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspendue",
};
