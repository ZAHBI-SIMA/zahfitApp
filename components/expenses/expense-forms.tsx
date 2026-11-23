"use client";

import { useEffect, useRef } from "react";
import { Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/validation";
import {
  addAttachmentAction,
  createCategoryAction,
  createExpenseAction,
  removeAttachmentAction,
  toggleCategoryAction,
  voidExpenseAction,
} from "@/modules/expenses/expenses.actions";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

function useResetOnSuccess(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function ExpenseForm({ categories, today }: { categories: { id: string; name: string }[]; today: string }) {
  const { state, pending, onSubmit } = useFormAction(createExpenseAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-4" encType="multipart/form-data">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="spentOn" label="Date *" state={state}>
          <Input id="spentOn" name="spentOn" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field name="categoryId" label="Catégorie *" state={state}>
          <NativeSelect id="categoryId" name="categoryId" defaultValue="" required>
            <option value="" disabled>
              Choisir…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="amountXof" label="Montant (FCFA) *" state={state}>
          <Input id="amountXof" name="amountXof" inputMode="numeric" required />
        </Field>
        <Field name="label" label="Libellé *" state={state} className="sm:col-span-2">
          <Input id="label" name="label" placeholder="Facture CIE novembre" required />
        </Field>
        <Field name="method" label="Payée par *" state={state}>
          <NativeSelect id="method" name="method" defaultValue="CASH">
            <option value="CASH">Espèces (sort de la caisse)</option>
            <option value="MOBILE_MONEY">Mobile Money</option>
            <option value="TRANSFER">Virement</option>
            <option value="CARD">Carte bancaire</option>
          </NativeSelect>
        </Field>
        <Field name="supplier" label="Fournisseur" state={state}>
          <Input id="supplier" name="supplier" />
        </Field>
        <Field name="reference" label="N° de facture / transaction" state={state}>
          <Input id="reference" name="reference" />
        </Field>
        <Field name="file" label="Justificatif" state={state} hint="Photo ou PDF, 5 Mo max.">
          <Input id="file" name="file" type="file" accept={ACCEPT} />
        </Field>
        <Field name="note" label="Note" state={state} className="sm:col-span-3">
          <Input id="note" name="note" />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer la dépense"}
        </Button>
      </div>
    </form>
  );
}

export function VoidExpenseForm({ expenseId }: { expenseId: string }) {
  const { state, pending, onSubmit } = useFormAction(voidExpenseAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Annuler cette dépense ? Si elle a été payée en espèces, le montant revient dans la caisse ouverte.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <FormMessage state={state} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <div className="flex gap-2">
        <Input
          id={`reason-${expenseId}`}
          name="reason"
          placeholder="Motif (doublon, erreur…)"
          aria-label="Motif de l'annulation"
          required
        />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function AttachmentForm({ expenseId }: { expenseId: string }) {
  const { state, pending, onSubmit } = useFormAction(addAttachmentAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-2" encType="multipart/form-data">
      <FormMessage state={state} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <div className="flex gap-2">
        <Input id={`file-${expenseId}`} name="file" type="file" accept={ACCEPT} aria-label="Justificatif" required />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Joindre
        </Button>
      </div>
    </form>
  );
}

export function RemoveAttachmentButton({ attachmentId, fileName }: { attachmentId: string; fileName: string }) {
  const { state, pending, onSubmit } = useFormAction(removeAttachmentAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm(`Retirer « ${fileName} » ?`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="inline"
    >
      <input type="hidden" name="attachmentId" value={attachmentId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-destructive hover:underline"
        aria-label={`Retirer ${fileName}`}
      >
        retirer
      </button>
      {state.ok === false && <span className="ml-2 text-xs text-destructive">{state.message}</span>}
    </form>
  );
}

export function CategoryForm() {
  const { state, pending, onSubmit } = useFormAction(createCategoryAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Input id="category-name" name="name" placeholder="Nouvelle catégorie" aria-label="Nom de la catégorie" required />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Ajouter
        </Button>
      </div>
    </form>
  );
}

export function ToggleCategoryButton({ categoryId, isActive }: { categoryId: string; isActive: boolean }) {
  const { pending, onSubmit } = useFormAction(toggleCategoryAction);
  return (
    <form onSubmit={onSubmit} className="inline">
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button type="submit" disabled={pending} className="text-xs text-muted-foreground hover:underline">
        {isActive ? "masquer" : "réactiver"}
      </button>
    </form>
  );
}
