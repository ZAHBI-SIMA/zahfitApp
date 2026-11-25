import { Suspense, type ReactNode } from "react";
import { can } from "@/lib/rbac/permissions";
import { canAccessSpace, type Space, type TenantSpace } from "@/lib/rbac/spaces";
import { NAVIGATION } from "@/lib/navigation";
import { PERMISSION_FEATURE, hasFeature } from "@/modules/saas/features";
import { getTenantContext, guardSpace, guardSuperAdmin } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/labels";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";

const TENANT_SPACES: TenantSpace[] = ["admin", "reception", "coach", "member"];

/**
 * Cadre commun des 5 espaces. La lecture de session se fait DANS la
 * frontière <Suspense> : avec `cacheComponents`, c'est obligatoire et cela
 * permet d'afficher immédiatement le squelette pendant la vérification.
 */
export function SpaceFrame({ space, children }: { space: Space; children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <GuardedShell space={space}>{children}</GuardedShell>
    </Suspense>
  );
}

async function GuardedShell({ space, children }: { space: Space; children: ReactNode }) {
  const shell = await loadShell(space);
  return (
    <AppShell space={space} {...shell}>
      {children}
    </AppShell>
  );
}

/**
 * Données du CADRE (menu, nom, salle, rôle) — cache PRIVÉ, propre à la
 * session : rien n'est conservé côté serveur d'une requête à l'autre, mais
 * le navigateur peut garder ce cadre quelques minutes. C'est ce qui permet à
 * Next d'inclure le cadre dans l'« App Shell » préchargé : la navigation
 * entre les pages d'un espace est alors instantanée (squelette `loading.tsx`).
 *
 * Ce cache ne protège RIEN : chaque page rappelle `requireSpace()` et chaque
 * Server Action `requireActionContext()`, sans cache, à chaque requête. Au
 * pire, un menu reste affiché quelques minutes après un changement de rôle,
 * mais les pages et actions correspondantes sont refusées aussitôt.
 */
async function loadShell(space: Space) {
  "use cache: private";

  if (space === "super-admin") {
    const user = await guardSuperAdmin();
    const ctx = await getTenantContext();
    return {
      nav: NAVIGATION[space],
      userName: user.name,
      otherSpaces: ctx ? TENANT_SPACES.filter((s) => canAccessSpace(ctx.role, s)) : [],
    };
  }

  const ctx = await guardSpace(space);
  const otherSpaces: Space[] = TENANT_SPACES.filter((s) => s !== space && canAccessSpace(ctx.role, s));
  if (ctx.user.platformRole === "SUPER_ADMIN") otherSpaces.unshift("super-admin");
  return {
    nav: NAVIGATION[space].filter(
      (item) =>
        (!item.permission || can(ctx.role, item.permission)) &&
        hasFeature(ctx.features, item.feature ?? (item.permission ? PERMISSION_FEATURE[item.permission] : undefined)),
    ),
    userName: ctx.user.name,
    tenantName: ctx.tenant.name,
    alert:
      space !== "member" && (ctx.billingStatus === "PAST_DUE" || ctx.billingStatus === "READ_ONLY")
        ? {
            message:
              ctx.billingStatus === "READ_ONLY"
                ? "Espace en lecture seule : une facture ZAHFIT est impayée."
                : "Une facture ZAHFIT est en retard de paiement.",
            href: can(ctx.role, "billing.settings.manage") ? "/admin/facturation" : undefined,
          }
        : undefined,
    roleLabel: ROLE_LABELS[ctx.role],
    otherSpaces,
  };
}
