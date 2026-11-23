"use server";

import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant, type Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { can } from "@/lib/rbac/permissions";
import { parseForm, type FormState } from "@/lib/validation";
import {
  bookSession,
  cancelBooking,
  markAttendance,
  updateBookingSettings,
} from "@/modules/bookings/bookings.service";
import { flushOutboxQuietly, markAllRead } from "@/modules/notifications/notifications.service";

const idField = (label: string) => z.uuid({ error: `${label} introuvable.` });

/** Fiche adhérent liée au compte connecté, dans la salle active. */
async function ownMember(tx: Tx, tenantId: string, userId: string) {
  const member = await tx.member.findFirst({ where: { userId, tenantId }, select: { id: true } });
  if (!member) throw new BusinessError("Votre compte n'est pas relié à une fiche adhérent.");
  return member.id;
}

// --- Adhérent (ses propres réservations) ---------------------------------------

export async function bookOwnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("self.bookings");
    const parsed = parseForm(z.object({ sessionId: idField("Séance") }), formData);
    if (parsed.state) return parsed.state;
    const booking = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const memberId = await ownMember(tx, ctx.tenant.id, ctx.user.id);
      return bookSession(
        tx,
        { tenantId: ctx.tenant.id, userId: ctx.user.id },
        { sessionId: parsed.data.sessionId, memberId },
        { byStaff: false },
      );
    });
    await flushOutboxQuietly(ctx.tenant.id);
    return ok(
      booking.status === "CONFIRMED"
        ? "Place réservée."
        : "Séance complète : vous êtes sur la liste d'attente, nous vous préviendrons si une place se libère.",
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function cancelOwnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("self.bookings");
    const parsed = parseForm(z.object({ bookingId: idField("Réservation") }), formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const memberId = await ownMember(tx, ctx.tenant.id, ctx.user.id);
      return cancelBooking(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.bookingId, {
        byStaff: false,
        memberId,
      });
    });
    await flushOutboxQuietly(ctx.tenant.id);
    return ok("Réservation annulée.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function markAllReadAction(): Promise<FormState> {
  try {
    const ctx = await requireActionContext("self.profile");
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => markAllRead(tx, ctx.user.id));
    return ok("Notifications marquées comme lues.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Accueil (pour le compte d'un adhérent) --------------------------------------

/** Retrouve un adhérent par son code (ADH-000123) ou son téléphone. */
async function findMemberByCodeOrPhone(tx: Tx, query: string) {
  const text = query.trim();
  const phone = normalizePhone(text);
  const member = await tx.member.findFirst({
    where: { OR: [{ code: text.toUpperCase() }, ...(phone ? [{ phone }] : [])], status: { not: "ARCHIVED" } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) throw new BusinessError("Aucun adhérent avec ce code ou ce téléphone.", "member");
  return member;
}

export async function staffBookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("bookings.manage");
    const parsed = parseForm(
      z.object({
        sessionId: idField("Séance"),
        member: z.string().trim().min(3, "Code adhérent ou téléphone."),
      }),
      formData,
    );
    if (parsed.state) return parsed.state;
    const { booking, name } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      const member = await findMemberByCodeOrPhone(tx, parsed.data.member);
      const booking = await bookSession(
        tx,
        { tenantId: ctx.tenant.id, userId: ctx.user.id },
        { sessionId: parsed.data.sessionId, memberId: member.id },
        { byStaff: true },
      );
      return { booking, name: `${member.firstName} ${member.lastName}` };
    });
    await flushOutboxQuietly(ctx.tenant.id);
    return ok(
      booking.status === "CONFIRMED"
        ? `${name} : place réservée.`
        : `${name} : séance complète, ajouté(e) à la liste d'attente.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function staffCancelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("bookings.manage");
    const parsed = parseForm(
      z.object({
        bookingId: idField("Réservation"),
        reason: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((v) => v || null),
      }),
      formData,
    );
    if (parsed.state) return parsed.state;
    const { promoted } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      cancelBooking(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.bookingId, {
        byStaff: true,
        reason: parsed.data.reason,
      }),
    );
    await flushOutboxQuietly(ctx.tenant.id);
    return ok(
      `Réservation annulée${promoted ? ` — ${promoted} personne(s) de la liste d'attente confirmée(s)` : ""}.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}

// --- Présences ---------------------------------------------------------------------

/**
 * Pointage : permission attendance.write. Un coach ne pointe que SES
 * séances ; l'administration (classes.manage) pointe toutes les séances.
 */
export async function markAttendanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("attendance.write");
    const parsed = parseForm(
      z.object({
        bookingId: idField("Réservation"),
        attendance: z.enum(["PRESENT", "ABSENT", "NONE"]),
      }),
      formData,
    );
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
      if (!can(ctx.role, "classes.manage")) {
        const booking = await tx.booking.findUnique({
          where: { id: parsed.data.bookingId },
          select: { session: { select: { coach: { select: { userId: true } } } } },
        });
        if (booking?.session.coach.userId !== ctx.user.id) {
          throw new BusinessError("Vous ne pouvez pointer que vos propres séances.");
        }
      }
      const value = parsed.data.attendance === "NONE" ? null : parsed.data.attendance;
      await markAttendance(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.bookingId, value);
    });
    return ok("Présence enregistrée.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Réglages ------------------------------------------------------------------

const bookingSettingsSchema = z.object({
  bookingOpenDays: z.coerce
    .number({ error: "Valeur invalide." })
    .int()
    .min(1, "1 jour minimum.")
    .max(60, "60 jours maximum."),
  bookingCancelHours: z.coerce
    .number({ error: "Valeur invalide." })
    .int()
    .min(0, "0 minimum.")
    .max(72, "72 heures maximum."),
});

export async function updateBookingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("tenant.settings.manage");
    const parsed = parseForm(bookingSettingsSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateBookingSettings(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    return ok("Réglages des réservations enregistrés.");
  } catch (error) {
    return toFormState(error);
  }
}
