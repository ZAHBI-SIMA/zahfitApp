"use client";

import { useState } from "react";
import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatXof } from "@/lib/format";
import type { DurationUnit } from "@/lib/generated/prisma/enums";
import { PAYMENT_METHOD_LABELS, formatDuration } from "@/lib/labels";
import type { FormState } from "@/lib/validation";
import {
  assignSubscriptionAction,
  cancelSubscriptionAction,
  collectPaymentAction,
  extendSubscriptionAction,
  freezeSubscriptionAction,
  unfreezeSubscriptionAction,
} from "@/modules/subscriptions/subscriptions.actions";

function PaymentFields({ state }: { state: FormState }) {
  const [method, setMethod] = useState("CASH");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="method" label="Moyen de paiement" state={state}>
        <NativeSelect id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {method !== "CASH" && (
        <Field name="providerRef" label="Référence de transaction *" state={state} hint="N° de transaction Mobile Money, de virement…">
          <Input id="providerRef" name="providerRef" autoComplete="off" />
        </Field>
      )}
    </div>
  );
}

type PlanOption = { id: string; name: string; priceXof: number; durationValue: number; durationUnit: DurationUnit };

export function AssignSubscriptionForm({
  memberId,
  plans,
  canCollect,
}: {
  memberId: string;
  plans: PlanOption[];
  canCollect: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(assignSubscriptionAction);
  const [collectNow, setCollectNow] = useState(canCollect);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const selected = plans.find((p) => p.id === planId);

  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune formule en vente : créez-en une dans « Formules ».</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="memberId" value={memberId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="planId" label="Formule" state={state}>
          <NativeSelect id="planId" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatXof(p.priceXof)} · {formatDuration(p.durationValue, p.durationUnit)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="startDate"
          label="Date de début"
          state={state}
          hint="Vide = aujourd'hui, ou le lendemain de l'abonnement en cours"
        >
          <Input id="startDate" name="startDate" type="date" />
        </Field>
      </div>
      {canCollect && selected && selected.priceXof > 0 && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3">
          <Checkbox
            name="collectNow"
            label={`Encaisser maintenant ${formatXof(selected.priceXof)}`}
            checked={collectNow}
            onChange={(e) => setCollectNow(e.target.checked)}
          />
          {collectNow && <PaymentFields state={state} />}
        </div>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : collectNow && selected?.priceXof ? "Attribuer et encaisser" : "Attribuer la formule"}
        </Button>
      </div>
    </form>
  );
}

export function CollectPaymentForm({ subscriptionId, amountXof }: { subscriptionId: string; amountXof: number }) {
  const { state, pending, onSubmit } = useFormAction(collectPaymentAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <PaymentFields state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : `Encaisser ${formatXof(amountXof)}`}
        </Button>
      </div>
    </form>
  );
}

/** Bouton simple déclenchant une action sur un abonnement (suspendre, reprendre). */
function SimpleAction({
  subscriptionId,
  action,
  label,
  confirmText,
  variant = "outline",
}: {
  subscriptionId: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  confirmText?: string;
  variant?: "outline" | "secondary";
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form
      onSubmit={(event) => {
        if (confirmText && !confirm(confirmText)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

function ExtendForm({ subscriptionId }: { subscriptionId: string }) {
  const { state, pending, onSubmit } = useFormAction(extendSubscriptionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <div className="grid gap-3 sm:grid-cols-[100px_1fr]">
        <Field name="days" label="Jours" state={state}>
          <Input id="days" name="days" type="number" min={1} max={90} defaultValue={7} />
        </Field>
        <Field name="reason" label="Motif *" state={state}>
          <Input id="reason" name="reason" placeholder="Geste commercial, fermeture travaux…" />
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          Prolonger
        </Button>
      </div>
    </form>
  );
}

function CancelForm({ subscriptionId, paid }: { subscriptionId: string; paid: boolean }) {
  const { state, pending, onSubmit } = useFormAction(cancelSubscriptionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {paid && (
        <p className="text-xs text-muted-foreground">
          Abonnement déjà payé : aucun remboursement automatique (remboursements au Sprint 4).
        </p>
      )}
      <Field name="reason" label="Motif *" state={state}>
        <Input id="cancel-reason" name="reason" placeholder="Erreur de saisie, départ de l'adhérent…" />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Annuler l&apos;abonnement
        </Button>
      </div>
    </form>
  );
}

export type SubscriptionPermissions = {
  canWrite: boolean;
  canCollect: boolean;
  canExtend: boolean;
  canCancelPaid: boolean;
};

/** Actions disponibles selon le statut RÉEL de l'abonnement et les droits du rôle. */
export function SubscriptionActions({
  subscriptionId,
  status,
  priceXof,
  freezeAvailable,
  permissions,
}: {
  subscriptionId: string;
  status: string;
  priceXof: number;
  freezeAvailable: boolean;
  permissions: SubscriptionPermissions;
}) {
  const pending = status === "PENDING_PAYMENT";
  const paid = !pending && priceXof > 0;
  const canCancel = permissions.canWrite && (!paid || permissions.canCancelPaid);

  return (
    <div className="flex flex-col gap-3">
      {pending && permissions.canCollect && <CollectPaymentForm subscriptionId={subscriptionId} amountXof={priceXof} />}
      <div className="flex flex-wrap items-start gap-2">
        {status === "ACTIVE" && permissions.canWrite && freezeAvailable && (
          <SimpleAction
            subscriptionId={subscriptionId}
            action={freezeSubscriptionAction}
            label="Suspendre"
            confirmText="Suspendre l'abonnement à partir d'aujourd'hui ? La fin sera repoussée à la reprise."
          />
        )}
        {status === "FROZEN" && permissions.canWrite && (
          <SimpleAction subscriptionId={subscriptionId} action={unfreezeSubscriptionAction} label="Reprendre" variant="secondary" />
        )}
      </div>
      {permissions.canExtend && ["ACTIVE", "UPCOMING", "FROZEN"].includes(status) && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Prolonger (geste commercial)</summary>
          <div className="mt-3">
            <ExtendForm subscriptionId={subscriptionId} />
          </div>
        </details>
      )}
      {canCancel && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium text-destructive">Annuler</summary>
          <div className="mt-3">
            <CancelForm subscriptionId={subscriptionId} paid={paid} />
          </div>
        </details>
      )}
    </div>
  );
}
