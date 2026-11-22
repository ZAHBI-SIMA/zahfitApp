"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { FormError, authErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // 2FA activée : le plugin client redirige vers /connexion/2fa.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;

    router.replace("/espace");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Adresse e-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Mot de passe</Label>
          <Link href="/mot-de-passe-oublie" className="text-xs text-muted-foreground hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
