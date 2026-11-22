"use client";

import { Checkbox, Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toDateInput } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { createMemberAction, updateMemberAction } from "@/modules/members/members.actions";
import type { MemberBasePath } from "@/modules/members/members.schema";

type MemberValues = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  birthDate: Date | null;
  consentWhatsapp: boolean;
  consentSms: boolean;
  consentEmail: boolean;
};

export function MemberForm({
  basePath,
  member,
  readOnly = false,
}: {
  basePath: MemberBasePath;
  member?: MemberValues;
  readOnly?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(member ? updateMemberAction : createMemberAction);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="basePath" value={basePath} />
      {member && <input type="hidden" name="id" value={member.id} />}

      <fieldset disabled={readOnly || pending} className="grid gap-4 sm:grid-cols-2">
        <Field name="lastName" label="Nom *" state={state}>
          <Input id="lastName" name="lastName" defaultValue={member?.lastName} autoComplete="family-name" required />
        </Field>
        <Field name="firstName" label="Prénom(s) *" state={state}>
          <Input id="firstName" name="firstName" defaultValue={member?.firstName} autoComplete="given-name" required />
        </Field>
        <Field name="phone" label="Téléphone *" state={state} hint="Ex. 07 01 02 03 04 — sert d'identifiant unique">
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={member ? formatPhone(member.phone) : ""}
            autoComplete="tel"
            required
          />
        </Field>
        <Field name="email" label="E-mail" state={state}>
          <Input id="email" name="email" type="email" defaultValue={member?.email ?? ""} autoComplete="email" />
        </Field>
        <Field name="birthDate" label="Date de naissance" state={state}>
          <Input id="birthDate" name="birthDate" type="date" defaultValue={toDateInput(member?.birthDate)} />
        </Field>
      </fieldset>

      <fieldset disabled={readOnly || pending} className="rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Consentements de communication</legend>
        <p className="mb-3 text-xs text-muted-foreground">
          À cocher uniquement avec l&apos;accord explicite de l&apos;adhérent (rappels, offres).
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="consentWhatsapp" label="WhatsApp" defaultChecked={member?.consentWhatsapp} />
          <Checkbox name="consentSms" label="SMS" defaultChecked={member?.consentSms} />
          <Checkbox name="consentEmail" label="E-mail" defaultChecked={member?.consentEmail} />
        </div>
      </fieldset>

      {!readOnly && (
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Enregistrement…" : member ? "Enregistrer les modifications" : "Inscrire l'adhérent"}
          </Button>
        </div>
      )}
    </form>
  );
}
