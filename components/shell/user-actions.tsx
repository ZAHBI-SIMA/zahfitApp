"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("zf-theme", dark ? "dark" : "light");
    } catch {
      // stockage indisponible (navigation privée) : le choix vaut pour la page seulement
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Basculer mode clair / sombre">
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    await authClient.signOut();
    router.replace("/connexion");
    router.refresh();
  };

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
      <LogOut className="size-4" aria-hidden />
      Déconnexion
    </Button>
  );
}
