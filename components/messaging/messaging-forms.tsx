"use client";

import { Checkbox, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { updateMessagingSettingsAction } from "@/modules/messaging/messaging.actions";
import { startRenewalAction } from "@/modules/payments/online.actions";

export function MessagingSettingsForm({ whatsappEnabled, smsEnabled }: { whatsappEnabled: boolean; smsEnabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(updateMessagingSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Checkbox
        name="whatsappEnabled"
        label="Envoyer les rappels par WhatsApp (modèles « utilitaires » validés par Meta)"
        defaultChecked={whatsappEnabled}
      />
      <Checkbox
        name="smsEnabled"
        label="Envoyer par SMS si WhatsApp échoue ou n'est pas accepté par l'adhérent"
        defaultChecked={smsEnabled}
      />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

export function RenewalForm({ slug, token, amountLabel }: { slug: string; token: string; amountLabel: string }) {
  const { state, pending, onSubmit } = useFormAction(startRenewalAction);
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" disabled={pending} className="bg-brand text-brand-foreground hover:bg-brand/90">
        {pending ? "Redirection vers le paiement…" : `Payer ${amountLabel} par Mobile Money`}
      </Button>
    </form>
  );
}
