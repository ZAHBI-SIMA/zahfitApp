import Link from "next/link";
import type { ReactNode } from "react";
import type { NavItem } from "@/lib/navigation";
import { SPACE_LABELS, type Space } from "@/lib/rbac/spaces";
import { Logo } from "@/components/shell/logo";
import { NavLinks } from "@/components/shell/nav-links";
import { SignOutButton, ThemeToggle } from "@/components/shell/user-actions";

type AppShellProps = {
  space: Space;
  nav: NavItem[];
  userName: string;
  tenantName?: string;
  roleLabel?: string;
  /** Autres espaces accessibles avec le même compte (ex. admin → réception). */
  otherSpaces: Space[];
  /** Bandeau d'alerte (ex. facture ZAHFIT en retard). */
  alert?: { message: string; href?: string };
  children: ReactNode;
};

const SPACE_HREF: Record<Space, string> = {
  "super-admin": "/super-admin",
  admin: "/admin",
  reception: "/reception",
  coach: "/coach",
  member: "/member",
};

export function AppShell(props: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0">
        <div className="flex items-center justify-between md:block">
          <Logo className="text-white" />
          <p className="text-xs uppercase tracking-wider opacity-70 md:mt-3">
            {SPACE_LABELS[props.space]}
          </p>
        </div>
        {props.tenantName && (
          <div className="rounded-lg bg-sidebar-accent/60 px-3 py-2 text-sm">
            <p className="font-medium">{props.tenantName}</p>
            {props.roleLabel && <p className="text-xs opacity-70">{props.roleLabel}</p>}
          </div>
        )}
        <nav aria-label="Navigation principale" className="flex-1">
          <NavLinks items={props.nav} />
        </nav>
        {props.otherSpaces.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-sidebar-border pt-4 text-sm">
            <p className="px-3 text-xs uppercase tracking-wider opacity-60">Autres espaces</p>
            {props.otherSpaces.map((space) => (
              <Link
                key={space}
                href={SPACE_HREF[space]}
                className="rounded-lg px-3 py-1.5 hover:bg-sidebar-accent"
              >
                {SPACE_LABELS[space]}
              </Link>
            ))}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b px-4 py-3 md:px-8">
          <span className="mr-auto truncate text-sm text-muted-foreground">
            Connecté : <span className="font-medium text-foreground">{props.userName}</span>
          </span>
          <ThemeToggle />
          <SignOutButton />
        </header>
        {props.alert && (
          <div role="alert" className="border-b border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm md:px-8">
            {props.alert.message}{" "}
            {props.alert.href && (
              <Link href={props.alert.href} className="font-medium underline">
                Régler maintenant
              </Link>
            )}
          </div>
        )}
        <main className="flex-1 px-4 py-6 md:px-8">{props.children}</main>
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row" aria-busy="true">
      <div className="h-16 bg-sidebar md:h-screen md:w-64" />
      <div className="flex-1 animate-pulse p-8">
        <div className="h-6 w-48 rounded bg-muted" />
        <div className="mt-6 h-32 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
