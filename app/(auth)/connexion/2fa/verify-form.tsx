"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { FormError, authErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function VerifyTwoFactorForm() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code")).replace(/\s/g, "");
    const trustDevice = form.get("trust") === "on";
    setPending(true);
    setError(null);

    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });

    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.replace("/espace");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{useBackup ? "Code de secours" : "Code à 6 chiffres"}</Label>
        <Input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          pattern={useBackup ? undefined : "[0-9 ]{6,7}"}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="trust" className="size-4 accent-[var(--brand)]" />
        Faire confiance à cet appareil pendant 30 jours
      </label>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Vérification…" : "Valider"}
      </Button>
      <Button type="button" variant="link" onClick={() => setUseBackup((v) => !v)}>
        {useBackup ? "Utiliser l'application d'authentification" : "Utiliser un code de secours"}
      </Button>
    </form>
  );
}
