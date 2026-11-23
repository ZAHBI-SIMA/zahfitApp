"use client";

import { Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import {
  bookOwnAction,
  cancelOwnAction,
  markAllReadAction,
  markAttendanceAction,
  staffBookAction,
  staffCancelAction,
  updateBookingSettingsAction,
} from "@/modules/bookings/bookings.actions";

// --- Adhérent ------------------------------------------------------------------

export function BookButton({ sessionId, full }: { sessionId: string; full: boolean }) {
  const { state, pending, onSubmit } = useFormAction(bookOwnAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" size="sm" variant={full ? "outline" : "default"} disabled={pending}>
        {pending ? "…" : full ? "Liste d'attente" : "Réserver"}
      </Button>
      {state.message && !state.ok && <p className="max-w-56 text-right text-xs text-destructive">{state.message}</p>}
    </form>
  );
}

export function CancelOwnButton({ bookingId, waitlisted }: { bookingId: string; waitlisted: boolean }) {
  const { state, pending, onSubmit } = useFormAction(cancelOwnAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm(waitlisted ? "Quitter la liste d'attente ?" : "Annuler cette réservation ?")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {waitlisted ? "Quitter la liste" : "Annuler"}
      </Button>
      {state.message && !state.ok && <p className="max-w-56 text-right text-xs text-destructive">{state.message}</p>}
    </form>
  );
}

export function MarkAllReadButton() {
  const { pending, onSubmit } = useFormAction(markAllReadAction);
  return (
    <form onSubmit={onSubmit}>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Tout marquer comme lu
      </Button>
    </form>
  );
}

// --- Accueil ---------------------------------------------------------------------

export function StaffBookForm({ sessionId }: { sessionId: string }) {
  const { state, pending, onSubmit } = useFormAction(staffBookAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="member" label="Inscrire un adhérent" state={state} className="min-w-56 flex-1">
          <Input id={`member-${sessionId}`} name="member" placeholder="ADH-000123 ou 07 00 00 00 00" autoComplete="off" />
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          Inscrire
        </Button>
      </div>
    </form>
  );
}

export function StaffCancelButton({ bookingId }: { bookingId: string }) {
  const { state, pending, onSubmit } = useFormAction(staffCancelAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Annuler cette réservation ? L'adhérent sera prévenu.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.message && !state.ok && <span className="text-xs text-destructive">{state.message}</span>}
      <Button type="submit" size="xs" variant="ghost" disabled={pending} aria-label="Retirer cette réservation">
        Retirer
      </Button>
    </form>
  );
}

// --- Présences -----------------------------------------------------------------

export function AttendanceButtons({ bookingId, attendance }: { bookingId: string; attendance: AttendanceStatus | null }) {
  const { state, pending, onSubmit } = useFormAction(markAttendanceAction);
  const choice = (value: "PRESENT" | "ABSENT", label: string, activeClass: string) => (
    <Button
      type="submit"
      name="attendance"
      value={attendance === value ? "NONE" : value}
      size="xs"
      variant="outline"
      disabled={pending}
      aria-pressed={attendance === value}
      className={cn(attendance === value && activeClass)}
    >
      {label}
    </Button>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center justify-end gap-1">
      <input type="hidden" name="bookingId" value={bookingId} />
      {choice("PRESENT", "Présent", "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white")}
      {choice("ABSENT", "Absent", "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white")}
      {state.message && !state.ok && <span className="w-full text-right text-xs text-destructive">{state.message}</span>}
    </form>
  );
}

// --- Réglages ------------------------------------------------------------------

export function BookingSettingsForm({ openDays, cancelHours }: { openDays: number; cancelHours: number }) {
  const { state, pending, onSubmit } = useFormAction(updateBookingSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="bookingOpenDays" label="Ouverture des réservations (jours avant)" state={state}>
          <Input id="bookingOpenDays" name="bookingOpenDays" type="number" min={1} max={60} defaultValue={openDays} />
        </Field>
        <Field
          name="bookingCancelHours"
          label="Annulation libre jusqu'à (heures avant)"
          state={state}
          hint="Au-delà, seul l'accueil peut annuler."
        >
          <Input
            id="bookingCancelHours"
            name="bookingCancelHours"
            type="number"
            min={0}
            max={72}
            defaultValue={cancelHours}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
