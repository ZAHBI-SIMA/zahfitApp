import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { homeSpaceFor } from "@/lib/rbac/spaces";
import { getTenantContext, isSuperAdmin, requireUser } from "@/lib/session";
import { Logo } from "@/components/shell/logo";
import { SignOutButton } from "@/components/shell/user-actions";

export const metadata: Metadata = { title: "Mon espace" };

/**
 * Aiguillage après connexion : envoie chacun vers SON espace.
 * Route BLOQUANTE (pas de <Suspense>) : la redirection doit partir avant
 * tout rendu, sous forme de vraie réponse 307. Une redirection émise en
 * plein streaming laisse le navigateur sur l'ancienne URL.
 */
export const instant = false;

export default async function EspacePage() {
  const user = await requireUser();
  if (isSuperAdmin(user)) redirect("/super-admin");

  const ctx = await getTenantContext();
  const home = ctx ? homeSpaceFor(ctx.role) : null;
  if (home) redirect(`/${home}`);

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="text-xl font-semibold">Aucun espace disponible</h1>
      <p className="text-sm text-muted-foreground">
        Votre compte n&apos;est rattaché à aucune salle, ou votre rôle ne donne accès à aucun
        espace. Contactez l&apos;administrateur de votre salle.
      </p>
      <SignOutButton />
    </main>
  );
}
