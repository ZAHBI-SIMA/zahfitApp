"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { FormError, authErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function MotDePasseOubliePage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reinitialiser-mot-de-passe",
    });
    setPending(false);
    // Même message que l'e-mail existe ou non (anti-énumération).
    if (error && error.status === 429) setError(authErrorMessage(error));
    else setSent(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mot de passe oublié</CardTitle>
        <CardDescription>Recevez un lien pour choisir un nouveau mot de passe.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sent ? (
          <p className="text-sm">
            Si un compte correspond à cette adresse, un e-mail vient d&apos;être envoyé. Le lien est
            valable 1 heure.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormError message={error} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Envoi…" : "Envoyer le lien"}
            </Button>
          </form>
        )}
        <Link href="/connexion" className="text-center text-sm text-muted-foreground hover:underline">
          Retour à la connexion
        </Link>
      </CardContent>
    </Card>
  );
}
