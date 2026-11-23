import "server-only";
import { refresh } from "next/cache";
import { BusinessError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { ForbiddenError, requirePermission } from "@/lib/rbac/guard";
import { requiresTwoFactor, type Permission } from "@/lib/rbac/permissions";
import { getTenantContext, isSuperAdmin, requireUser, type SessionUser, type TenantContext } from "@/lib/session";
import type { FormState } from "@/lib/validation";

/**
 * Garde des Server Actions. Une action ne lève jamais d'erreur métier vers
 * le client : `toFormState` la convertit en message lisible.
 */

const enforce2FA = () => process.env.ENFORCE_2FA !== "false";

/**
 * Contexte d'une action de salle. Revérifie TOUT côté serveur : salle
 * active et non suspendue, 2FA pour les rôles sensibles, permission.
 * Un bouton masqué dans l'interface n'est jamais une protection suffisante.
 */
export async function requireActionContext(permission: Permission): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new ForbiddenError(permission);
  if (ctx.tenant.status === "SUSPENDED") throw new BusinessError("L'accès à cette salle est suspendu.");
  if (enforce2FA() && requiresTwoFactor(ctx.role) && !ctx.user.twoFactorEnabled) {
    throw new BusinessError("Activez la double authentification pour effectuer cette action.");
  }
  requirePermission(ctx, permission);
  return ctx;
}

export async function requirePlatformActionUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) throw new BusinessError("Réservé à l'équipe ZahDigit.");
  if (enforce2FA() && !user.twoFactorEnabled) {
    throw new BusinessError("Activez la double authentification pour effectuer cette action.");
  }
  return user;
}

/**
 * Succès d'une mutation. `refresh()` relance le rendu serveur de la page
 * courante : sans lui, une Server Action renvoie son message mais les
 * données affichées (statut d'abonnement, liste…) restent périmées.
 */
export function ok(message: string): FormState {
  refresh();
  return { ok: true, message };
}

/** Convertit toute erreur connue en état de formulaire ; relance le reste. */
export function toFormState(error: unknown): FormState {
  if (error instanceof BusinessError) {
    return {
      ok: false,
      message: error.message,
      errors: error.field ? { [error.field]: [error.message] } : undefined,
    };
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, message: "Vous n'avez pas l'autorisation d'effectuer cette action." };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, message: "Cette valeur est déjà utilisée." };
  }
  // Les redirections de Next (redirect()) et les erreurs inattendues continuent leur chemin.
  throw error;
}
