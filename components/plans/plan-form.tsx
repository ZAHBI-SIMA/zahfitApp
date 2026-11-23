"use client";

import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DurationUnit } from "@/lib/generated/prisma/enums";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { createPlanAction, updatePlanAction } from "@/modules/plans/plans.actions";

type PlanValues = {
  id: string;
  name: string;
  description: string | null;
  priceXof: number;
  durationValue: number;
  durationUnit: DurationUnit;
  benefits: string[];
  allowedDays: number[];
  accessFrom: string | null;
  accessUntil: string | null;
  maxEntries: number | null;
  maxFreezeDays: number;
  isActive: boolean;
};

export function PlanForm({ plan }: { plan?: PlanValues }) {
  const { state, pending, onSubmit } = useFormAction(plan ? updatePlanAction : createPlanAction);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      {plan && <input type="hidden" name="id" value={plan.id} />}

      <section className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nom de la formule *" state={state}>
          <Input id="name" name="name" defaultValue={plan?.name} placeholder="Mensuel, Étudiant, VIP…" required />
        </Field>
        <Field name="priceXof" label="Prix (FCFA) *" state={state} hint="0 = formule gratuite (essai, offert)">
          <Input id="priceXof" name="priceXof" inputMode="numeric" defaultValue={plan?.priceXof ?? ""} required />
        </Field>
        <div className="flex gap-3">
          <Field name="durationValue" label="Durée *" state={state} className="w-24">
            <Input id="durationValue" name="durationValue" type="number" min={1} defaultValue={plan?.durationValue ?? 1} required />
          </Field>
          <Field name="durationUnit" label="Unité" state={state} className="flex-1">
            <NativeSelect id="durationUnit" name="durationUnit" defaultValue={plan?.durationUnit ?? "MONTH"}>
              <option value="DAY">Jour(s)</option>
              <option value="WEEK">Semaine(s)</option>
              <option value="MONTH">Mois</option>
              <option value="YEAR">An(s)</option>
            </NativeSelect>
          </Field>
        </div>
        <Field name="description" label="Description" state={state}>
          <Input id="description" name="description" defaultValue={plan?.description ?? ""} />
        </Field>
        <Field
          name="benefits"
          label="Avantages (un par ligne)"
          state={state}
          className="sm:col-span-2"
          hint="Ex. Accès musculation · Cours collectifs illimités · Serviette offerte"
        >
          <Textarea id="benefits" name="benefits" rows={3} defaultValue={plan?.benefits.join("\n") ?? ""} />
        </Field>
      </section>

      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Restrictions d&apos;accès</legend>
        <p className="-mt-2 text-xs text-muted-foreground">
          Enregistrées dès maintenant, appliquées au contrôle d&apos;accès par QR Code (Sprint 6). Tout vide = sans restriction.
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Jours autorisés</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <Checkbox
                key={day}
                name="allowedDays"
                value={String(day)}
                label={WEEKDAY_LABELS[day]}
                defaultChecked={plan?.allowedDays.includes(day)}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="accessFrom" label="Accès à partir de" state={state}>
            <Input id="accessFrom" name="accessFrom" type="time" defaultValue={plan?.accessFrom ?? ""} />
          </Field>
          <Field name="accessUntil" label="Jusqu'à" state={state}>
            <Input id="accessUntil" name="accessUntil" type="time" defaultValue={plan?.accessUntil ?? ""} />
          </Field>
          <Field name="maxEntries" label="Entrées sur la période" state={state} hint="Vide = illimité">
            <Input id="maxEntries" name="maxEntries" type="number" min={1} defaultValue={plan?.maxEntries ?? ""} />
          </Field>
        </div>
        <Field
          name="maxFreezeDays"
          label="Jours de suspension autorisés"
          state={state}
          hint="Voyage, maladie… La fin de l'abonnement est repoussée d'autant. 0 = pas de suspension."
          className="sm:w-1/3"
        >
          <Input id="maxFreezeDays" name="maxFreezeDays" type="number" min={0} defaultValue={plan?.maxFreezeDays ?? 0} />
        </Field>
      </fieldset>

      {plan && (
        <Checkbox
          name="isActive"
          label="Formule proposée à la vente (décocher pour la retirer sans perdre l'historique)"
          defaultChecked={plan.isActive}
        />
      )}
      {!plan && <input type="hidden" name="isActive" value="on" />}

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Enregistrement…" : plan ? "Enregistrer la formule" : "Créer la formule"}
        </Button>
      </div>
    </form>
  );
}
