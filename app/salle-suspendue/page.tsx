import type { Metadata } from "next";
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
        Contactez le support ZahDigit pour rétablir l&apos;accès.
      </p>
      <SignOutButton />
    </main>
  );
}
