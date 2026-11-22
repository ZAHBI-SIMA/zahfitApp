import type { MemberSource, MemberStatus, TenantRole, TenantStatus } from "@/lib/generated/prisma/enums";

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
