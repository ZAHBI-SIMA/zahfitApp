"use client";

import { Checkbox, Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatXof } from "@/lib/format";
import { refundPaymentAction, updateBillingSettingsAction } from "@/modules/payments/payments.actions";

export function RefundForm({ paymentId, refundableXof }: { paymentId: string; refundableXof: number }) {
  const { state, pending, onSubmit } = useFormAction(refundPaymentAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Confirmer le remboursement ? Un avoir numéroté sera émis (opération définitive).")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-3"
    >
      <FormMessage state={state} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <Field name="amountXof" label="Montant (FCFA)" state={state} hint={`${formatXof(refundableXof)} max.`}>
          <Input id={`refund-amount-${paymentId}`} name="amountXof" inputMode="numeric" defaultValue={refundableXof} />
        </Field>
        <Field name="reason" label="Motif *" state={state}>
          <Input id={`refund-reason-${paymentId}`} name="reason" placeholder="Déménagement, erreur d'encaissement…" />
        </Field>
      </div>
      <Checkbox name="cancelSubscription" label="Annuler aussi l'abonnement" />
      <div>
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Enregistrement…" : "Rembourser"}
        </Button>
      </div>
    </form>
  );
}

export function BillingSettingsForm({
  settings,
}: {
  settings: { allowPartialPayment: boolean; minDepositPercent: number; receiptFooter: string | null };
}) {
  const { state, pending, onSubmit } = useFormAction(updateBillingSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <Checkbox
        name="allowPartialPayment"
        label="Autoriser le paiement en plusieurs fois"
        defaultChecked={settings.allowPartialPayment}
      />
      <Field
        name="minDepositPercent"
        label="Acompte minimum pour activer l'abonnement (%)"
        state={state}
        hint="Ex. 50 : l'abonnement démarre dès que la moitié est payée ; le reste apparaît dans « Soldes impayés »."
        className="sm:w-1/2"
      >
        <Input id="minDepositPercent" name="minDepositPercent" type="number" min={10} max={100} defaultValue={settings.minDepositPercent} />
      </Field>
      <Field
        name="receiptFooter"
        label="Mention en bas des reçus"
        state={state}
        hint="RCCM, n° de compte contribuable, conditions de remboursement…"
      >
        <Input id="receiptFooter" name="receiptFooter" defaultValue={settings.receiptFooter ?? ""} />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
