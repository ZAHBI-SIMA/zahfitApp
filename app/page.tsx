import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-primary text-primary-foreground dark:bg-background dark:text-foreground">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <Button
          nativeButton={false}
          render={<Link href="/connexion" />}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          Se connecter
        </Button>
      </header>
      <section className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Gérez, développez et fidélisez les adhérents de votre salle.
        </h1>
        <p className="text-lg opacity-80">
          Adhérents, abonnements, paiements Mobile Money, contrôle d&apos;accès et statistiques
          réunis dans une seule plateforme.
        </p>
      </section>
      <footer className="px-6 py-6 text-center text-sm opacity-60">ZAHFIT · par ZahDigit</footer>
    </main>
  );
}
