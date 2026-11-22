import type { TenantRole } from "@/lib/generated/prisma/enums";
import { can, type Permission } from "@/lib/rbac/permissions";

/**
 * Les 5 interfaces du cahier des charges (section 2).
 * L'accès à un espace de salle est DÉDUIT des permissions : il n'y a pas de
 * seconde liste « qui voit quoi » à maintenir en parallèle de la matrice.
 */
export type TenantSpace = "admin" | "reception" | "coach" | "member";
export type Space = "super-admin" | TenantSpace;

export const SPACE_KEY_PERMISSION: Record<TenantSpace, Permission> = {
  admin: "dashboard.view",
  reception: "access.scan",
  coach: "classes.read",
  member: "self.profile",
};

/** Ordre de préférence pour la page d'accueil après connexion. */
const SPACE_PRIORITY: TenantSpace[] = ["admin", "reception", "coach", "member"];

export function canAccessSpace(role: TenantRole, space: TenantSpace): boolean {
  return can(role, SPACE_KEY_PERMISSION[space]);
}

export function homeSpaceFor(role: TenantRole): TenantSpace | null {
  return SPACE_PRIORITY.find((space) => canAccessSpace(role, space)) ?? null;
}

export const SPACE_LABELS: Record<Space, string> = {
  "super-admin": "Super Admin",
  admin: "Administration",
  reception: "Réception",
  coach: "Espace coach",
  member: "Mon espace",
};
