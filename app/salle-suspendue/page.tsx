import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { SignOutButton } from "@/components/shell/user-actions";

export const metadata: Metadata = { title: "Accès suspendu" };

export default function SalleSuspenduePage() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="text-xl font-semibold">L&apos;accès à cette salle est suspendu</h1>
      <p className="text-sm text-muted-foreground">
        L&apos;abonnement ZAHFIT de l&apos;établissement est suspendu. Les données sont conservées.
        Si la suspension fait suite à une facture impayée, son règlement rétablit l&apos;accès immédiatement.
      </p>
      <Link
        href="/facturation"
        className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground"
      >
        Régler l&apos;abonnement ZAHFIT
      </Link>
      <p className="text-xs text-muted-foreground">Autre motif : contactez le support ZahDigit.</p>
      <SignOutButton />
    </main>
  );
}
