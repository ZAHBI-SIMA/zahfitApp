"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { FormError, authErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Enrollment = { qrDataUrl: string; secret: string; backupCodes: string[] };

/**
 * Activation en 2 étapes :
 *  1. mot de passe → Better Auth génère le secret TOTP (non encore actif) ;
 *  2. premier code valide → la 2FA est réellement activée.
 * Tant que l'étape 2 n'est pas faite, la connexion reste possible sans code :
 * impossible de se bloquer dehors en cas d'erreur de scan.
 */
export function SetupTwoFactor() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data) return setError(authErrorMessage(error));
    // ZAHFIT n'utilise que le TOTP (application d'authentification), pas l'OTP par e-mail/SMS.
    if (data.method !== "totp") return setError(authErrorMessage(null));

    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setEnrollment({
      qrDataUrl: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }),
      secret,
      backupCodes: data.backupCodes,
    });
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      return setError(authErrorMessage(error));
    }
    // /espace est rendu dynamiquement : pas besoin de router.refresh(), qui
    // annulerait cette navigation en re-rendant la page courante.
    router.replace("/espace");
  };

  if (!enrollment) {
    return (
      <form onSubmit={start} className="flex flex-col gap-4">
        <FormError message={error} />
        <p className="text-sm text-muted-foreground">
          Installez une application d&apos;authentification (Google Authenticator, Microsoft
          Authenticator, 2FAS…), puis confirmez votre mot de passe pour commencer.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Préparation…" : "Commencer"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4">
      <FormError message={error} />
      <p className="text-sm">1. Scannez ce QR Code avec votre application :</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée localement */}
      <img
        src={enrollment.qrDataUrl}
        alt="QR Code de configuration de la double authentification"
        className="mx-auto size-48 rounded-lg bg-white p-2"
      />
      <p className="text-xs text-muted-foreground">
        Ou saisissez la clé : <code className="break-all font-mono">{enrollment.secret}</code>
      </p>
      <div className="rounded-lg border bg-muted p-3">
        <p className="text-sm font-medium">2. Conservez vos codes de secours</p>
        <p className="text-xs text-muted-foreground">
          Chacun permet UNE connexion si vous perdez votre téléphone.
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
          {enrollment.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">3. Saisissez le code affiché</Label>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Vérification…" : "Activer la double authentification"}
      </Button>
    </form>
  );
}
