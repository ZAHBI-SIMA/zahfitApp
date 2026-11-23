"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Checkbox, Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startOnlineSignupAction } from "@/modules/payments/online.actions";

export function OnlineSignupForm({ slug, planId, amountLabel }: { slug: string; planId: string; amountLabel: string }) {
  const { state, pending, onSubmit } = useFormAction(startOnlineSignupAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="planId" value={planId} />
      {/* Piège à robots : invisible pour un humain, ignoré par les lecteurs d'écran. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="lastName" label="Nom *" state={state}>
          <Input id="lastName" name="lastName" autoComplete="family-name" required />
        </Field>
        <Field name="firstName" label="Prénom(s) *" state={state}>
          <Input id="firstName" name="firstName" autoComplete="given-name" required />
        </Field>
        <Field name="phone" label="Téléphone *" state={state} hint="Ex. 07 01 02 03 04">
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
        </Field>
        <Field name="email" label="E-mail *" state={state} hint="Pour recevoir votre reçu et accéder à votre espace">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <legend className="px-1 font-medium">Recevoir les rappels et offres de la salle (facultatif)</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox name="consentWhatsapp" label="WhatsApp" />
          <Checkbox name="consentSms" label="SMS" />
          <Checkbox name="consentEmail" label="E-mail" />
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <Checkbox
          name="acceptTerms"
          label="J'accepte les conditions d'inscription et le traitement de mes données par la salle (loi n° 2013-450)."
        />
        {state.errors?.acceptTerms?.map((e) => (
          <p key={e} className="text-xs text-destructive">
            {e}
          </p>
        ))}
      </div>
      <Button type="submit" size="lg" disabled={pending} className="bg-brand text-brand-foreground hover:bg-brand/90">
        {pending ? "Redirection vers le paiement…" : `Payer ${amountLabel} par Mobile Money`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Votre abonnement est activé dès la confirmation du paiement par l&apos;opérateur.
      </p>
    </form>
  );
}

/** Rafraîchit la page tant que le paiement est en attente de confirmation. */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
