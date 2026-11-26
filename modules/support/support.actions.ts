"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import { ok, requireActionContext, requirePlatformActionUser, toFormState } from "@/lib/actions";
import { withPlatform, withTenant } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { SUPPORT_ACCESS_COOKIE } from "@/lib/session";
import { parseForm, type FormState } from "@/lib/validation";
import {
  closeTicketAsTenant,
  createTicket,
  endSupportAccess,
  newTicketSchema,
  platformReplySchema,
  platformTicketUpdateSchema,
  replyAsPlatform,
  replyAsTenant,
  startSupportAccess,
  startSupportAccessSchema,
  tenantReplySchema,
  updateTicketAsPlatform,
} from "@/modules/support/support.service";

/**
 * Le support reste joignable quand la salle est en lecture seule ou
 * suspendue : c'est souvent à ce moment-là qu'elle en a le plus besoin.
 */
const SUPPORT_OPTIONS = { allowReadOnly: true, allowSuspended: true } as const;

async function deliver(mails: Parameters<typeof sendMail>[0][]) {
  for (const mail of mails) {
    await sendMail(mail).catch((error) =>
      console.error("[support] e-mail non envoyé", error instanceof Error ? error.message : error),
    );
  }
}

// --- Salle ---------------------------------------------------------------------------

export async function createTicketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let ticketId: string;
  try {
    const ctx = await requireActionContext("support.use", undefined, SUPPORT_OPTIONS);
    const parsed = parseForm(newTicketSchema, formData);
    if (parsed.state) return parsed.state;
    const { ticket, mails } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      createTicket(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    await deliver(mails);
    // Salle suspendue : l'espace d'administration est fermé, on reste sur place.
    if (ctx.tenant.status === "SUSPENDED") {
      return ok(`Ticket #${ticket.number} envoyé. La réponse du support vous parviendra par e-mail.`);
    }
    ticketId = ticket.id;
  } catch (error) {
    return toFormState(error);
  }
  redirect(`/admin/support/${ticketId}?cree=1`);
}

export async function replyTicketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("support.use", undefined, SUPPORT_OPTIONS);
    const parsed = parseForm(tenantReplySchema, formData);
    if (parsed.state) return parsed.state;
    const { mails } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      replyAsTenant(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    await deliver(mails);
    return ok("Réponse envoyée au support ZahDigit.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function closeTicketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("support.use", undefined, SUPPORT_OPTIONS);
    const ticketId = z.uuid().safeParse(formData.get("ticketId"));
    if (!ticketId.success) return { ok: false, message: "Ticket introuvable." };
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      closeTicketAsTenant(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, ticketId.data),
    );
    return ok("Ticket clos.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- ZahDigit -----------------------------------------------------------------------

export async function platformReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(platformReplySchema, formData);
    if (parsed.state) return parsed.state;
    const { mails } = await withPlatform(actor.id, (tx) => replyAsPlatform(tx, actor.id, parsed.data));
    await deliver(mails);
    return ok(parsed.data.internal ? "Note interne ajoutée (invisible pour la salle)." : "Réponse envoyée à la salle.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function platformUpdateTicketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(platformTicketUpdateSchema, formData);
    if (parsed.state) return parsed.state;
    await withPlatform(actor.id, (tx) => updateTicketAsPlatform(tx, actor.id, parsed.data));
    return ok("Ticket mis à jour.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Accès du support -----------------------------------------------------------------

/**
 * Ouvre l'espace d'un membre du personnel, en lecture seule. Le cookie ne
 * fait que DÉSIGNER l'accès : sa validité (agent, durée, fin) est relue en
 * base à chaque requête.
 */
export async function startSupportAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlatformActionUser();
    const parsed = parseForm(startSupportAccessSchema, formData);
    if (parsed.state) return parsed.state;
    const { access, mails } = await withPlatform(actor.id, (tx) =>
      startSupportAccess(tx, { id: actor.id, name: actor.name }, parsed.data),
    );
    (await cookies()).set(SUPPORT_ACCESS_COOKIE, access.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: access.expiresAt,
    });
    await deliver(mails);
  } catch (error) {
    return toFormState(error);
  }
  redirect("/espace");
}

export async function endSupportAccessAction(): Promise<void> {
  const actor = await requirePlatformActionUser();
  const tenantId = await withPlatform(actor.id, (tx) => endSupportAccess(tx, actor.id));
  (await cookies()).delete(SUPPORT_ACCESS_COOKIE);
  redirect(tenantId ? `/super-admin/salles/${tenantId}` : "/super-admin");
}
