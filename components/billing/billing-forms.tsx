"use client";

import { Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  extendTrialAction,
  markInvoicePaidAction,
  startInvoicePaymentAction,
  voidSaasInvoiceAction,
} from "@/modules/billing/billing.actions";

export function PayInvoiceButton({ invoiceId, amountLabel }: { invoiceId: string; amountLabel: string }) {
  const { state, pending, onSubmit } = useFormAction(startInvoicePaymentAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <FormMessage state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div>
        <Button type="submit" size="sm" disabled={pending} className="bg-brand text-brand-foreground hover:bg-brand/90">
          {pending ? "Redirection…" : `Payer ${amountLabel} (Mobile Money)`}
        </Button>
      </div>
    </form>
  );
}

export function MarkPaidForm({ invoiceId }: { invoiceId: string }) {
  const { state, pending, onSubmit } = useFormAction(markInvoicePaidAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <Field name="method" label="Reçu par" state={state}>
          <NativeSelect id={`method-${invoiceId}`} name="method" defaultValue="TRANSFER">
            <option value="TRANSFER">Virement</option>
            <option value="MOBILE_MONEY">Mobile Money</option>
            <option value="CASH">Espèces</option>
            <option value="CARD">Carte</option>
          </NativeSelect>
        </Field>
        <Field name="reference" label="Référence" state={state}>
          <Input id={`ref-${invoiceId}`} name="reference" />
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          Marquer réglée
        </Button>
      </div>
    </form>
  );
}

export function VoidSaasInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const { state, pending, onSubmit } = useFormAction(voidSaasInvoiceAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Annuler cette facture ? Elle reste visible, barrée, et ne sera plus due.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <FormMessage state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex gap-2">
        <Input id={`void-${invoiceId}`} name="reason" placeholder="Motif de l'annulation" aria-label="Motif" required />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function ExtendTrialForm({ tenantId }: { tenantId: string }) {
  const { state, pending, onSubmit } = useFormAction(extendTrialAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="flex items-end gap-2">
        <Field name="days" label="Prolonger l'essai de (jours)" state={state}>
          <Input id="days" name="days" inputMode="numeric" defaultValue={15} className="w-24" />
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Prolonger
        </Button>
      </div>
    </form>
  );
}
