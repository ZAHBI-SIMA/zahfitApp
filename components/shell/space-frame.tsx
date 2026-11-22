import { Suspense, type ReactNode } from "react";
import { can } from "@/lib/rbac/permissions";
import { canAccessSpace, type Space, type TenantSpace } from "@/lib/rbac/spaces";
import { NAVIGATION } from "@/lib/navigation";
import { requireSpace, requireSuperAdmin, getTenantContext } from "@/lib/session";
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
  if (space === "super-admin") {
    const user = await requireSuperAdmin();
    const ctx = await getTenantContext();
    const otherSpaces = ctx ? TENANT_SPACES.filter((s) => canAccessSpace(ctx.role, s)) : [];
    return (
      <AppShell space={space} nav={NAVIGATION[space]} userName={user.name} otherSpaces={otherSpaces}>
        {children}
      </AppShell>
    );
  }

  const ctx = await requireSpace(space);
  const nav = NAVIGATION[space].filter((item) => !item.permission || can(ctx.role, item.permission));
  const otherSpaces: Space[] = TENANT_SPACES.filter(
    (s) => s !== space && canAccessSpace(ctx.role, s),
  );
  if (ctx.user.platformRole === "SUPER_ADMIN") otherSpaces.unshift("super-admin");

  return (
    <AppShell
      space={space}
      nav={nav}
      userName={ctx.user.name}
      tenantName={ctx.tenant.name}
      roleLabel={ROLE_LABELS[ctx.role]}
      otherSpaces={otherSpaces}
    >
      {children}
    </AppShell>
  );
}
