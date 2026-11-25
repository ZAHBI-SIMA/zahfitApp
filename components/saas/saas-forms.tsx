"use client";

import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SaasFeature } from "@/lib/generated/prisma/enums";
import { FEATURE_LABELS, SAAS_FEATURES } from "@/modules/saas/features";
import { changeTenantPlanAction, createSaasPlanAction, updateSaasPlanAction } from "@/modules/saas/saas.actions";

type PlanValues = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPriceXof: number;
  setupFeeXof: number;
  features: SaasFeature[];
  maxMembers: number | null;
  maxStaff: number | null;
  maxWhatsappPerMonth: number | null;
  isActive: boolean;
  sortOrder: number;
};

/** Création (sans `plan`) ou modification d'un forfait. Limite vide = illimité. */
export function SaasPlanForm({ plan }: { plan?: PlanValues }) {
  const { state, pending, onSubmit } = useFormAction(plan ? updateSaasPlanAction : createSaasPlanAction);
  const id = (name: string) => `${name}-${plan?.id ?? "new"}`;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      {plan && <input type="hidden" name="planId" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        {!plan && (
          <Field name="code" label="Code *" state={state} hint="Ex. PREMIUM_PLUS (définitif)">
            <Input id={id("code")} name="code" required />
          </Field>
        )}
        <Field name="name" label="Nom *" state={state}>
          <Input id={id("name")} name="name" defaultValue={plan?.name} required />
        </Field>
        <Field name="monthlyPriceXof" label="Prix mensuel (FCFA) *" state={state}>
          <Input
            id={id("monthlyPriceXof")}
            name="monthlyPriceXof"
            inputMode="numeric"
            defaultValue={plan?.monthlyPriceXof}
            required
          />
        </Field>
        <Field name="setupFeeXof" label="Installation (FCFA) *" state={state}>
          <Input id={id("setupFeeXof")} name="setupFeeXof" inputMode="numeric" defaultValue={plan?.setupFeeXof ?? 0} required />
        </Field>
        <Field name="description" label="Description" state={state} className="sm:col-span-4">
          <Input id={id("description")} name="description" defaultValue={plan?.description ?? ""} />
        </Field>
        <Field name="maxMembers" label="Adhérents actifs max." state={state} hint="Vide : illimité">
          <Input id={id("maxMembers")} name="maxMembers" inputMode="numeric" defaultValue={plan?.maxMembers ?? ""} />
        </Field>
        <Field name="maxStaff" label="Comptes équipe max." state={state} hint="Vide : illimité">
          <Input id={id("maxStaff")} name="maxStaff" inputMode="numeric" defaultValue={plan?.maxStaff ?? ""} />
        </Field>
        <Field name="maxWhatsappPerMonth" label="WhatsApp / mois max." state={state} hint="Vide : illimité">
          <Input
            id={id("maxWhatsappPerMonth")}
            name="maxWhatsappPerMonth"
            inputMode="numeric"
            defaultValue={plan?.maxWhatsappPerMonth ?? ""}
          />
        </Field>
        <Field name="sortOrder" label="Ordre d'affichage" state={state}>
          <Input id={id("sortOrder")} name="sortOrder" inputMode="numeric" defaultValue={plan?.sortOrder ?? 0} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <legend className="px-1 font-medium">
          Modules inclus (le socle adhérents, abonnements, paiements, caisse est toujours inclus)
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SAAS_FEATURES.map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="features"
                value={f}
                defaultChecked={plan?.features.includes(f)}
                className="size-4 accent-brand"
              />
              {FEATURE_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>
      <Checkbox name="isActive" label="Proposé à la vente" defaultChecked={plan?.isActive ?? true} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : plan ? "Enregistrer le forfait" : "Créer le forfait"}
        </Button>
      </div>
    </form>
  );
}

export function TenantPlanForm({
  tenantId,
  currentPlanId,
  plans,
}: {
  tenantId: string;
  currentPlanId: string;
  plans: { id: string; name: string; monthlyPriceXof: number; isActive: boolean }[];
}) {
  const { state, pending, onSubmit } = useFormAction(changeTenantPlanAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <Field name="planId" label="Forfait" state={state}>
        <NativeSelect id="planId" name="planId" defaultValue={currentPlanId}>
          {plans
            .filter((p) => p.isActive || p.id === currentPlanId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {new Intl.NumberFormat("fr-FR").format(p.monthlyPriceXof)} FCFA / mois
                {!p.isActive ? " (retiré de la vente)" : ""}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Application…" : "Changer de forfait"}
        </Button>
      </div>
    </form>
  );
}
