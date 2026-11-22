"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { FormError, authErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return <FormError message="Lien invalide ou expiré. Refaites une demande de réinitialisation." />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p>Mot de passe modifié. Toutes vos sessions ouvertes ont été fermées par sécurité.</p>
        <Button nativeButton={false} render={<Link href="/connexion" />}>Se connecter</Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirmation</Label>
        <Input id="confirm" name="confirm" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}
