"use client";

import { useEffect, useRef } from "react";
import { Checkbox, Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SupportTicketPriority, SupportTicketStatus } from "@/lib/generated/prisma/enums";
import type { FormState } from "@/lib/validation";
import {
  closeTicketAction,
  createTicketAction,
  platformReplyAction,
  platformUpdateTicketAction,
  replyTicketAction,
  startSupportAccessAction,
} from "@/modules/support/support.actions";
import {
  SUPPORT_ACCESS_RULES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/modules/support/support.rules";

/** Vide le formulaire après un envoi réussi (useFormAction ne le fait pas, volontairement). */
function useResetOnSuccess(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function NewTicketForm() {
  const { state, pending, onSubmit } = useFormAction(createTicketAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="subject" label="Objet *" state={state}>
        <Input id="subject" name="subject" maxLength={160} placeholder="Ex. : le scan QR refuse un abonné à jour" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="category" label="Thème" state={state}>
          <NativeSelect id="category" name="category" defaultValue="TECHNICAL">
            {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="priority" label="Priorité" state={state}>
          <NativeSelect id="priority" name="priority" defaultValue="NORMAL">
            {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field
        name="body"
        label="Description *"
        state={state}
        hint="Ce que vous faisiez, ce qui s'est passé, et sur quel adhérent ou quelle page."
      >
        <Textarea id="body" name="body" rows={5} maxLength={5000} required />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer au support"}
        </Button>
      </div>
    </form>
  );
}

export function TenantReplyForm({ ticketId }: { ticketId: string }) {
  const { state, pending, onSubmit } = useFormAction(replyTicketAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <Field name="body" label="Votre réponse" state={state}>
        <Textarea id="reply" name="body" rows={4} maxLength={5000} required />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Répondre"}
        </Button>
      </div>
    </form>
  );
}

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const { state, pending, onSubmit } = useFormAction(closeTicketAction);
  return (
    <form
      onSubmit={(event) => {
        if (!confirm("Clore ce ticket ? Il ne pourra plus recevoir de réponse.")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <FormMessage state={state} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Clore le ticket
        </Button>
      </div>
    </form>
  );
}

const STATUS_OPTIONS = Object.entries(TICKET_STATUS_LABELS) as [SupportTicketStatus, string][];

export function PlatformReplyForm({ ticketId }: { ticketId: string }) {
  const { state, pending, onSubmit } = useFormAction(platformReplyAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <Field name="body" label="Message" state={state}>
        <Textarea id="platform-reply" name="body" rows={5} maxLength={5000} required />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field name="status" label="Statut après envoi" state={state} className="w-64">
          <NativeSelect id="reply-status" name="status" defaultValue="">
            <option value="">Par défaut (réponse attendue ; note : inchangé)</option>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Checkbox name="internal" label="Note interne (invisible pour la salle)" />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer"}
        </Button>
      </div>
    </form>
  );
}

export function PlatformTicketForm({
  ticketId,
  priority,
  status,
  assignedToMe,
}: {
  ticketId: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  assignedToMe: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(platformUpdateTicketAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <Field name="status" label="Statut" state={state}>
        <NativeSelect id="ticket-status" name="status" defaultValue={status}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="priority" label="Priorité" state={state}>
        <NativeSelect id="ticket-priority" name="priority" defaultValue={priority}>
          {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {!assignedToMe && <Checkbox name="assignToMe" label="Je prends ce ticket en charge" />}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Mettre à jour
        </Button>
      </div>
    </form>
  );
}

export function StartSupportAccessForm({
  tenantId,
  staff,
  tickets = [],
  ticketId,
}: {
  tenantId: string;
  staff: { userId: string; label: string }[];
  tickets?: { id: string; label: string }[];
  ticketId?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(startSupportAccessAction);
  if (staff.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun compte du personnel actif dans cette salle.</p>;
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <Field name="targetUserId" label="Voir l'espace de" state={state}>
        <NativeSelect id="targetUserId" name="targetUserId">
          {staff.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="reason" label="Motif (montré à la salle) *" state={state}>
        <Input id="reason" name="reason" maxLength={300} placeholder="Ex. : vérifier l'affichage du planning (ticket #12)" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="minutes" label="Durée" state={state}>
          <NativeSelect id="minutes" name="minutes" defaultValue={String(SUPPORT_ACCESS_RULES.defaultMinutes)}>
            {SUPPORT_ACCESS_RULES.durations.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} heure${m > 60 ? "s" : ""}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {ticketId ? (
          <input type="hidden" name="ticketId" value={ticketId} />
        ) : (
          tickets.length > 0 && (
            <Field name="ticketId" label="Ticket lié" state={state}>
              <NativeSelect id="ticketId" name="ticketId" defaultValue="">
                <option value="">Aucun</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Consultation seule : aucune modification possible. Les administrateurs de la salle sont prévenus par e-mail et
        l&apos;accès reste dans leur historique.
      </p>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Ouverture…" : "Ouvrir l'espace en lecture seule"}
        </Button>
      </div>
    </form>
  );
}
