import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { SaasFeature, TenantRole, TenantStatus } from "@/lib/generated/prisma/enums";
import { ROLE_PERMISSIONS, requiresTwoFactor, type Permission } from "@/lib/rbac/permissions";
import { canAccessSpace, type TenantSpace } from "@/lib/rbac/spaces";

/**
 * Data Access Layer de l'authentification : SEUL endroit où l'on lit la
 * session. Les layouts et pages appellent `requireSpace()` ; jamais
 * `auth.api.getSession` directement.
 */

export const ACTIVE_TENANT_COOKIE = "zf_tenant";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  platformRole: string | null;
  twoFactorEnabled: boolean;
};

export type TenantContext = {
  user: SessionUser;
  tenant: { id: string; name: string; slug: string; status: TenantStatus };
  role: TenantRole;
  permissions: readonly Permission[];
  /** Autres salles accessibles (pour le futur sélecteur de salle). */
  otherTenants: { id: string; name: string }[];
  /** Forfait ZAHFIT de la salle et modules qu'il inclut. */
  plan: { id: string; code: string; name: string };
  features: readonly SaasFeature[];
};

const enforce2FA = () => process.env.ENFORCE_2FA !== "false";

/** Session courante (mémoïsée pour la durée de la requête). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    platformRole: (u.platformRole as string | null | undefined) ?? null,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  return user;
}

export const isSuperAdmin = (user: SessionUser) => user.platformRole === "SUPER_ADMIN";

/** Salle active : celle du cookie si l'utilisateur y a accès, sinon la première. */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const user = await requireUser();

  const memberships = await withUser(user.id, (tx) =>
    tx.tenantMembership.findMany({
      where: { userId: user.id, status: "ACTIVE", tenant: { deletedAt: null } },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            saasPlan: { select: { id: true, code: true, name: true, features: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  );
  if (memberships.length === 0) return null;

  const wanted = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const active = memberships.find((m) => m.tenantId === wanted) ?? memberships[0];

  const { saasPlan, ...tenant } = active.tenant;
  return {
    user,
    tenant,
    plan: { id: saasPlan.id, code: saasPlan.code, name: saasPlan.name },
    features: saasPlan.features ?? [],
    role: active.role,
    permissions: ROLE_PERMISSIONS[active.role],
    otherTenants: memberships
      .filter((m) => m.tenantId !== active.tenantId)
      .map((m) => ({ id: m.tenant.id, name: m.tenant.name })),
  };
});

/**
 * Gardes « nues », sans `connection()` : réservées au cadre des espaces,
 * mis en cache privé (`"use cache: private"` interdit `connection()`).
 * Les pages utilisent `requireSuperAdmin()` / `requireSpace()` ci-dessous.
 */
export async function guardSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/espace");
  if (enforce2FA() && !user.twoFactorEnabled) redirect("/securite/2fa");
  return user;
}

export async function guardSpace(space: TenantSpace): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx || !canAccessSpace(ctx.role, space)) redirect("/espace");
  if (ctx.tenant.status === "SUSPENDED" && ctx.role !== "MEMBER") redirect("/salle-suspendue");
  if (enforce2FA() && requiresTwoFactor(ctx.role) && !ctx.user.twoFactorEnabled) {
    redirect("/securite/2fa");
  }
  return ctx;
}

/**
 * Garde d'une PAGE de l'espace Super Admin. `connection()` d'abord : la
 * vérification de session (horloge, base) se fait à la requête, jamais
 * pendant la préparation de l'App Shell. La page s'affiche dans le
 * squelette `loading.tsx` de l'espace le temps de cette vérification.
 */
export async function requireSuperAdmin(): Promise<SessionUser> {
  await connection();
  return guardSuperAdmin();
}

/**
 * Garde d'une PAGE d'un espace de salle (admin, réception, coach, adhérent).
 * `feature` : module du forfait requis. Absent, l'administration est envoyée
 * sur « Mon forfait » (qui explique quoi faire), les autres espaces sur leur accueil.
 */
export async function requireSpace(space: TenantSpace, feature?: SaasFeature): Promise<TenantContext> {
  await connection();
  const ctx = await guardSpace(space);
  if (feature && !ctx.features.includes(feature)) {
    redirect(space === "admin" ? `/admin/forfait?module=${feature}` : `/${space}`);
  }
  return ctx;
}
