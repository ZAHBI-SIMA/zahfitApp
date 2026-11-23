"use client";

import { useRef } from "react";
import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelSessionAction,
  createOneOffAction,
  createSeriesAction,
  restoreSessionAction,
  saveClassTypeAction,
  saveRoomAction,
  stopSeriesAction,
  updateSeriesAction,
  updateSessionAction,
  updateStaffProfileAction,
} from "@/modules/classes/classes.actions";
import { DAY_KEYS, DAY_NAMES } from "@/modules/classes/schedule";

export type ClassOptions = {
  types: { id: string; name: string; durationMinutes: number; defaultCapacity: number; isActive: boolean }[];
  coaches: { id: string; name: string; specialties: string[] }[];
  rooms: { id: string; name: string; capacity: number | null; isActive: boolean }[];
};

const DAY_FULL: Record<(typeof DAY_KEYS)[number], string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

type FieldErrors = { errors?: Record<string, string[] | undefined> };

// --- Salles de cours et types ------------------------------------------------

export function RoomForm({ room }: { room?: { id: string; name: string; capacity: number | null; isActive: boolean } }) {
  const { state, pending, onSubmit } = useFormAction(saveRoomAction);
  const key = room?.id ?? "new";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      {room && <input type="hidden" name="roomId" value={room.id} />}
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_110px_auto_auto]">
        <Field name="name" label="Nom" state={state}>
          <Input id={`room-name-${key}`} name="name" defaultValue={room?.name} placeholder="Studio, Box, Plateau…" />
        </Field>
        <Field name="capacity" label="Capacité" state={state}>
          <Input
            id={`room-cap-${key}`}
            name="capacity"
            inputMode="numeric"
            defaultValue={room?.capacity ?? ""}
            placeholder="—"
          />
        </Field>
        {room ? <Checkbox name="isActive" label="Active" defaultChecked={room.isActive} /> : <span />}
        <Button type="submit" size="sm" variant={room ? "outline" : "default"} disabled={pending}>
          {room ? "Enregistrer" : "Ajouter"}
        </Button>
      </div>
    </form>
  );
}

type TypeValues = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  durationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
};

export function ClassTypeForm({ type }: { type?: TypeValues }) {
  const { state, pending, onSubmit } = useFormAction(saveClassTypeAction);
  const key = type?.id ?? "new";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      {type && <input type="hidden" name="typeId" value={type.id} />}
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_64px_100px_100px]">
        <Field name="name" label="Cours" state={state}>
          <Input id={`type-name-${key}`} name="name" defaultValue={type?.name} placeholder="Yoga, Cross-training…" />
        </Field>
        <Field name="color" label="Couleur" state={state}>
          <Input id={`type-color-${key}`} name="color" type="color" defaultValue={type?.color ?? "#E67334"} className="p-1" />
        </Field>
        <Field name="durationMinutes" label="Durée (min)" state={state}>
          <Input
            id={`type-dur-${key}`}
            name="durationMinutes"
            type="number"
            min={10}
            max={480}
            defaultValue={type?.durationMinutes ?? 60}
          />
        </Field>
        <Field name="defaultCapacity" label="Places" state={state}>
          <Input
            id={`type-cap-${key}`}
            name="defaultCapacity"
            type="number"
            min={1}
            max={500}
            defaultValue={type?.defaultCapacity ?? 20}
          />
        </Field>
      </div>
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Field name="description" label="Description" state={state}>
          <Input id={`type-desc-${key}`} name="description" defaultValue={type?.description ?? ""} placeholder="Facultatif" />
        </Field>
        {type ? <Checkbox name="isActive" label="Proposé" defaultChecked={type.isActive} /> : <span />}
        <Button type="submit" size="sm" variant={type ? "outline" : "default"} disabled={pending}>
          {type ? "Enregistrer" : "Ajouter"}
        </Button>
      </div>
    </form>
  );
}

// --- Créneau commun (coach, salle, heure, durée, places) ----------------------

type SlotValues = { coachId: string; roomId: string | null; startTime: string; durationMinutes: number; capacity: number };

function SlotFields({
  options,
  state,
  values,
  durationRef,
  capacityRef,
}: {
  options: ClassOptions;
  state: FieldErrors;
  values?: SlotValues;
  durationRef?: React.Ref<HTMLInputElement>;
  capacityRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Field name="coachId" label="Coach *" state={state} className="lg:col-span-2">
        <NativeSelect id="coachId" name="coachId" defaultValue={values?.coachId ?? ""}>
          <option value="" disabled>
            Choisir…
          </option>
          {options.coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.specialties.length ? ` — ${c.specialties.join(", ")}` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="roomId" label="Salle de cours" state={state}>
        <NativeSelect id="roomId" name="roomId" defaultValue={values?.roomId ?? ""}>
          <option value="">Aucune</option>
          {options.rooms
            .filter((r) => r.isActive || r.id === values?.roomId)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` (${r.capacity})` : ""}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field name="startTime" label="Heure *" state={state}>
        <Input id="startTime" name="startTime" type="time" defaultValue={values?.startTime ?? "18:00"} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field name="durationMinutes" label="Durée" state={state}>
          <Input
            ref={durationRef}
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={10}
            max={480}
            defaultValue={values?.durationMinutes ?? 60}
          />
        </Field>
        <Field name="capacity" label="Places" state={state}>
          <Input
            ref={capacityRef}
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            max={500}
            defaultValue={values?.capacity ?? 20}
          />
        </Field>
      </div>
    </div>
  );
}

/** Choisir un type de cours préremplit sa durée et son nombre de places. */
function usePrefill() {
  const durationRef = useRef<HTMLInputElement>(null);
  const capacityRef = useRef<HTMLInputElement>(null);
  const onPick = (type: ClassOptions["types"][number]) => {
    if (durationRef.current) durationRef.current.value = String(type.durationMinutes);
    if (capacityRef.current) capacityRef.current.value = String(type.defaultCapacity);
  };
  return { durationRef, capacityRef, onPick };
}

function TypeSelect({
  options,
  state,
  defaultValue,
  onPick,
}: {
  options: ClassOptions;
  state: FieldErrors;
  defaultValue?: string;
  onPick: (type: ClassOptions["types"][number]) => void;
}) {
  return (
    <Field name="classTypeId" label="Cours *" state={state}>
      <NativeSelect
        id="classTypeId"
        name="classTypeId"
        defaultValue={defaultValue ?? ""}
        onChange={(e) => {
          const type = options.types.find((t) => t.id === e.target.value);
          if (type) onPick(type);
        }}
      >
        <option value="" disabled>
          Choisir…
        </option>
        {options.types
          .filter((t) => t.isActive || t.id === defaultValue)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </NativeSelect>
    </Field>
  );
}

// --- Cours régulier ------------------------------------------------------------

type SeriesValues = SlotValues & {
  id: string;
  classTypeId: string;
  weekday: number;
  startsOn: string;
  endsOn: string | null;
};

export function SeriesForm({ options, today, series }: { options: ClassOptions; today: string; series?: SeriesValues }) {
  const { state, pending, onSubmit } = useFormAction(series ? updateSeriesAction : createSeriesAction);
  const prefill = usePrefill();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {series && <input type="hidden" name="seriesId" value={series.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TypeSelect options={options} state={state} defaultValue={series?.classTypeId} onPick={prefill.onPick} />
        <Field name="weekday" label="Jour *" state={state}>
          <NativeSelect id="weekday" name="weekday" defaultValue={String(series?.weekday ?? 1)}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="startsOn" label="À partir du *" state={state}>
          <Input id="startsOn" name="startsOn" type="date" defaultValue={series?.startsOn ?? today} />
        </Field>
        <Field name="endsOn" label="Jusqu'au" state={state} hint="Vide = sans fin">
          <Input id="endsOn" name="endsOn" type="date" defaultValue={series?.endsOn ?? ""} />
        </Field>
      </div>
      <SlotFields
        options={options}
        state={state}
        values={series}
        durationRef={prefill.durationRef}
        capacityRef={prefill.capacityRef}
      />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : series ? "Enregistrer le cours" : "Créer le cours et ses séances"}
        </Button>
      </div>
    </form>
  );
}

export function StopSeriesForm({ seriesId, today }: { seriesId: string; today: string }) {
  const { state, pending, onSubmit } = useFormAction(stopSeriesAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Arrêter ce cours régulier ? Les séances après la date choisie seront retirées.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-3"
    >
      <FormMessage state={state} />
      <input type="hidden" name="seriesId" value={seriesId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="lastDay" label="Dernier jour du cours" state={state}>
          <Input id="lastDay" name="lastDay" type="date" defaultValue={today} />
        </Field>
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Arrêter le cours
        </Button>
      </div>
    </form>
  );
}

// --- Séances ------------------------------------------------------------------

export function OneOffForm({ options, date }: { options: ClassOptions; date: string }) {
  const { state, pending, onSubmit } = useFormAction(createOneOffAction);
  const prefill = usePrefill();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TypeSelect options={options} state={state} onPick={prefill.onPick} />
        <Field name="date" label="Date *" state={state}>
          <Input id="date" name="date" type="date" defaultValue={date} />
        </Field>
      </div>
      <SlotFields options={options} state={state} durationRef={prefill.durationRef} capacityRef={prefill.capacityRef} />
      <Field name="notes" label="Note" state={state}>
        <Input id="notes" name="notes" placeholder="Stage, cours découverte… (facultatif)" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Ajouter la séance"}
        </Button>
      </div>
    </form>
  );
}

export function SessionEditForm({
  options,
  session,
}: {
  options: ClassOptions;
  session: SlotValues & { id: string; date: string; notes: string | null };
}) {
  const { state, pending, onSubmit } = useFormAction(updateSessionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={session.id} />
      <Field name="date" label="Date *" state={state} className="sm:w-1/3">
        <Input id="date" name="date" type="date" defaultValue={session.date} />
      </Field>
      <SlotFields options={options} state={state} values={session} />
      <Field name="notes" label="Note" state={state}>
        <Input id="notes" name="notes" defaultValue={session.notes ?? ""} placeholder="Remplaçant, changement de salle…" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Modifier cette séance"}
        </Button>
      </div>
    </form>
  );
}

export function CancelSessionForm({ sessionId }: { sessionId: string }) {
  const { state, pending, onSubmit } = useFormAction(cancelSessionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="reason" label="Motif de l'annulation *" state={state} className="min-w-64 flex-1">
          <Input id="reason" name="reason" placeholder="Coach absent, jour férié…" />
        </Field>
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Annuler la séance
        </Button>
      </div>
    </form>
  );
}

export function RestoreSessionForm({ sessionId }: { sessionId: string }) {
  const { state, pending, onSubmit } = useFormAction(restoreSessionAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Rétablir la séance
        </Button>
      </div>
    </form>
  );
}

// --- Profil employé ------------------------------------------------------------

export function StaffProfileForm({
  membershipId,
  values,
}: {
  membershipId: string;
  values: { phone: string | null; bio: string | null; specialties: string[]; availability: Record<string, string[]> | null };
}) {
  const { state, pending, onSubmit } = useFormAction(updateStaffProfileAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="phone" label="Téléphone" state={state}>
          <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
        </Field>
        <Field name="specialties" label="Spécialités" state={state} hint="Séparées par des virgules">
          <Input
            id="specialties"
            name="specialties"
            defaultValue={values.specialties.join(", ")}
            placeholder="Yoga, Cross-training"
          />
        </Field>
      </div>
      <Field name="bio" label="Présentation" state={state}>
        <Textarea id="bio" name="bio" rows={3} defaultValue={values.bio ?? ""} />
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Disponibilités hebdomadaires</legend>
        <p className="text-xs text-muted-foreground">
          Format 06:00-12:00, plusieurs créneaux séparés par une virgule. Tout laisser vide = aucune contrainte. Une fois
          renseignées, un cours ne peut être programmé que sur ces créneaux.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DAY_KEYS.map((day) => (
            <Field key={day} name={`dispo_${day}`} label={DAY_FULL[day]} state={state}>
              <Input
                id={`dispo_${day}`}
                name={`dispo_${day}`}
                defaultValue={values.availability?.[day]?.join(", ") ?? ""}
                placeholder="—"
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer le profil"}
        </Button>
      </div>
    </form>
  );
}
