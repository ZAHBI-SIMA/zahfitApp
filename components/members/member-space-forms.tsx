"use client";

import { Checkbox, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { renewOnlineAction, updateMyConsentsAction } from "@/modules/members/member-space.actions";

export function ConsentsForm({
  consents,
}: {
  consents: { consentWhatsapp: boolean; consentSms: boolean; consentEmail: boolean };
}) {
  const { state, pending, onSubmit } = useFormAction(updateMyConsentsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Checkbox
        name="consentWhatsapp"
        label="WhatsApp (rappels d'échéance, cours annulés)"
        defaultChecked={consents.consentWhatsapp}
      />
      <Checkbox name="consentSms" label="SMS (si WhatsApp n'est pas disponible)" defaultChecked={consents.consentSms} />
      <Checkbox
        name="consentEmail"
        label="E-mail (reçus et informations de la salle)"
        defaultChecked={consents.consentEmail}
      />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer mes préférences"}
        </Button>
      </div>
    </form>
  );
}

export function RenewOnlineButton({ label }: { label: string }) {
  const { state, pending, onSubmit } = useFormAction(renewOnlineAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending} className="bg-brand text-brand-foreground hover:bg-brand/90">
          {pending ? "Préparation…" : label}
        </Button>
      </div>
    </form>
  );
}
