"use client";

import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone } from "@/lib/phone";
import type { FormState } from "@/lib/validation";
import {
  createTenantAction,
  setTenantSuspendedAction,
  updateTenantAction,
  updateTenantSettingsAction,
} from "@/modules/tenants/tenants.actions";
import { DAYS, DAY_LABELS, type OpeningHours, type Socials } from "@/modules/tenants/tenants.schema";

type TenantIdentity = {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  commune: string | null;
  city: string | null;
};

function IdentityFields({ state, tenant }: { state: FormState; tenant?: Partial<TenantIdentity> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Nom commercial *" state={state}>
        <Input id="name" name="name" defaultValue={tenant?.name} required />
      </Field>
      <Field name="phone" label="Téléphone" state={state}>
        <Input id="phone" name="phone" type="tel" defaultValue={tenant?.phone ? formatPhone(tenant.phone) : ""} />
      </Field>
      <Field name="email" label="E-mail" state={state}>
        <Input id="email" name="email" type="email" defaultValue={tenant?.email ?? ""} />
      </Field>
      <Field name="address" label="Adresse" state={state}>
        <Input id="address" name="address" defaultValue={tenant?.address ?? ""} />
      </Field>
      <Field name="commune" label="Commune" state={state}>
        <Input id="commune" name="commune" defaultValue={tenant?.commune ?? ""} placeholder="Cocody" />
      </Field>
      <Field name="city" label="Ville" state={state}>
        <Input id="city" name="city" defaultValue={tenant?.city ?? "Abidjan"} />
      </Field>
    </div>
  );
}

export function CreateTenantForm({ plans }: { plans: { id: string; name: string; monthlyPriceXof: number }[] }) {
  const { state, pending, onSubmit } = useFormAction(createTenantAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-medium">Établissement</legend>
        <IdentityFields state={state} />
        <Field
          name="slug"
          label="Identifiant d'URL"
          state={state}
          hint="Facultatif : généré à partir du nom (ex. salle-pilote-cocody)"
        >
          <Input id="slug" name="slug" />
        </Field>
        <Field name="saasPlanId" label="Forfait ZAHFIT *" state={state} hint="Modifiable ensuite depuis la fiche de la salle">
          <NativeSelect id="saasPlanId" name="saasPlanId" defaultValue="" required>
            <option value="" disabled>
              Choisir…
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {new Intl.NumberFormat("fr-FR").format(p.monthlyPriceXof)} FCFA / mois
              </option>
            ))}
          </NativeSelect>
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-medium">Administrateur de la salle</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="adminName" label="Nom complet *" state={state}>
            <Input id="adminName" name="adminName" required />
          </Field>
          <Field name="adminEmail" label="E-mail *" state={state} hint="Recevra un lien pour choisir son mot de passe">
            <Input id="adminEmail" name="adminEmail" type="email" required />
          </Field>
        </div>
      </fieldset>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Création…" : "Créer la salle"}
        </Button>
      </div>
    </form>
  );
}

export function EditTenantForm({ tenant }: { tenant: TenantIdentity }) {
  const { state, pending, onSubmit } = useFormAction(updateTenantAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={tenant.id} />
      <IdentityFields state={state} tenant={tenant} />
      <Field name="slug" label="Identifiant d'URL *" state={state}>
        <Input id="slug" name="slug" defaultValue={tenant.slug} required />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

export function SuspendTenantForm({ tenantId, suspended }: { tenantId: string; suspended: boolean }) {
  const { state, pending, onSubmit } = useFormAction(setTenantSuspendedAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={tenantId} />
      <input type="hidden" name="suspended" value={suspended ? "false" : "true"} />
      {!suspended && (
        <Field name="reason" label="Motif de la suspension *" state={state}>
          <Input id="reason" name="reason" placeholder="Ex. impayé de 2 mois" />
        </Field>
      )}
      <div>
        <Button type="submit" variant={suspended ? "secondary" : "destructive"} disabled={pending}>
          {suspended ? "Réactiver la salle" : "Suspendre la salle"}
        </Button>
      </div>
    </form>
  );
}

export function TenantSettingsForm({
  tenant,
  description,
  hours,
  socials,
}: {
  tenant: TenantIdentity;
  description: string | null;
  hours: OpeningHours;
  socials: Socials;
}) {
  const { state, pending, onSubmit } = useFormAction(updateTenantSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
      <FormMessage state={state} />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Informations de l&apos;établissement</h2>
        <IdentityFields state={state} tenant={tenant} />
        <Field name="description" label="Description" state={state} hint="Affichée sur la page publique de la salle (Sprint 5)">
          <Textarea id="description" name="description" rows={3} defaultValue={description ?? ""} />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Horaires d&apos;ouverture</h2>
        <div className="flex flex-col gap-2">
          {DAYS.map((day) => {
            const [open, close] = hours[day]?.split("-") ?? ["06:00", "22:00"];
            const error = state.errors?.[`hours_${day}`]?.[0];
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-24 font-medium">{DAY_LABELS[day]}</span>
                <Input name={`open_${day}`} type="time" defaultValue={open} aria-label={`${DAY_LABELS[day]} ouverture`} className="w-28" />
                <span aria-hidden>→</span>
                <Input name={`close_${day}`} type="time" defaultValue={close} aria-label={`${DAY_LABELS[day]} fermeture`} className="w-28" />
                <Checkbox name={`closed_${day}`} label="Fermé" defaultChecked={hours[day] === null} />
                {error && <span className="text-xs text-destructive">{error}</span>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Réseaux sociaux</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="facebook" label="Facebook" state={state}>
            <Input id="facebook" name="facebook" type="url" defaultValue={socials.facebook ?? ""} placeholder="https://facebook.com/…" />
          </Field>
          <Field name="instagram" label="Instagram" state={state}>
            <Input id="instagram" name="instagram" type="url" defaultValue={socials.instagram ?? ""} placeholder="https://instagram.com/…" />
          </Field>
          <Field name="tiktok" label="TikTok" state={state}>
            <Input id="tiktok" name="tiktok" type="url" defaultValue={socials.tiktok ?? ""} placeholder="https://tiktok.com/@…" />
          </Field>
          <Field name="website" label="Site web" state={state}>
            <Input id="website" name="website" type="url" defaultValue={socials.website ?? ""} placeholder="https://…" />
          </Field>
        </div>
      </section>

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer les paramètres"}
        </Button>
      </div>
    </form>
  );
}
