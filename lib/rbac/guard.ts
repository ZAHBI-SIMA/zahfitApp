import type { TenantRole } from "@/lib/generated/prisma/enums";
import { can, type Permission } from "@/lib/rbac/permissions";

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Action non autorisée (${permission})`);
    this.name = "ForbiddenError";
  }
}

/**
 * À appeler en PREMIÈRE ligne de chaque Server Action / Route Handler qui
 * modifie des données. Masquer un bouton dans l'interface ne suffit jamais :
 * la vérification qui compte est celle du serveur.
 */
export function requirePermission(ctx: { role: TenantRole }, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new ForbiddenError(permission);
}
