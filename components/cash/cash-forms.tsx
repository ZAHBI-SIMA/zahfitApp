"use client";

import { useEffect, useRef } from "react";
import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCashMovementAction,
  closeCashSessionAction,
  openCashSessionAction,
  updateCashSettingsAction,
  validateCashSessionAction,
} from "@/modules/cash/cash.actions";
import type { FormState } from "@/lib/validation";

/** Vide le formulaire après un succès (un montant resté affiché serait ressaisi par erreur). */
function useResetOnSuccess(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function OpenCashForm() {
  const { state, pending, onSubmit } = useFormAction(openCashSessionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field
        name="openingFloatXof"
        label="Fond de caisse compté (FCFA)"
        state={state}
        hint="Billets et pièces présents dans le tiroir à l'ouverture."
        className="sm:w-1/2"
      >
        <Input id="openingFloatXof" name="openingFloatXof" inputMode="numeric" placeholder="25 000" required />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Ouverture…" : "Ouvrir la caisse"}
        </Button>
      </div>
    </form>
  );
}

export function CashMovementForm() {
  const { state, pending, onSubmit } = useFormAction(addCashMovementAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[140px_140px_1fr]">
        <Field name="kind" label="Type" state={state}>
          <NativeSelect id="kind" name="kind" defaultValue="WITHDRAWAL">
            <option value="WITHDRAWAL">Retrait</option>
            <option value="DEPOSIT">Apport</option>
          </NativeSelect>
        </Field>
        <Field name="amountXof" label="Montant (FCFA)" state={state}>
          <Input id="amountXof" name="amountXof" inputMode="numeric" required />
        </Field>
        <Field name="label" label="Motif" state={state}>
          <Input id="label" name="label" placeholder="Remise en banque, monnaie…" required />
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer le mouvement"}
        </Button>
      </div>
    </form>
  );
}

export function CloseCashForm({ expectedLabel }: { expectedLabel: string }) {
  const { state, pending, onSubmit } = useFormAction(closeCashSessionAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Clôturer la caisse ? Plus aucune opération en espèces n'y sera possible.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-3"
    >
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field
          name="countedXof"
          label="Espèces comptées (FCFA)"
          state={state}
          hint={`Comptez avant de regarder le théorique (${expectedLabel}).`}
        >
          <Input id="countedXof" name="countedXof" inputMode="numeric" required />
        </Field>
        <Field name="closingNote" label="Explication de l'écart" state={state} hint="Obligatoire s'il y a un écart.">
          <Input id="closingNote" name="closingNote" placeholder="Erreur de rendu de monnaie…" />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Clôture…" : "Compter et clôturer"}
        </Button>
      </div>
    </form>
  );
}

export function ValidateCashForm({ sessionId, hasDifference }: { sessionId: string; hasDifference: boolean }) {
  const { state, pending, onSubmit } = useFormAction(validateCashSessionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <Field
        name="validationNote"
        label={hasDifference ? "Suite donnée à l'écart *" : "Commentaire"}
        state={state}
        hint={hasDifference ? "Retenue, erreur retrouvée, perte acceptée…" : undefined}
      >
        <Input id={`validationNote-${sessionId}`} name="validationNote" />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Validation…" : "Valider la caisse"}
        </Button>
      </div>
    </form>
  );
}

export function CashSettingsForm({ cashSessionRequired }: { cashSessionRequired: boolean }) {
  const { state, pending, onSubmit } = useFormAction(updateCashSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Checkbox
        name="cashSessionRequired"
        label="Refuser toute opération en espèces tant que la caisse n'est pas ouverte"
        defaultChecked={cashSessionRequired}
      />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
