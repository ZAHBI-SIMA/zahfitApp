"use server";

import QRCode from "qrcode";
import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/rbac/guard";
import { parseForm, type FormState } from "@/lib/validation";
import {
  accessSnapshot,
  checkAccess,
  issueBadge,
  revokeBadge,
  syncOfflineEvents,
  updateAccessSettings,
} from "@/modules/access/access.service";
import type { AccessSnapshot, ScanResult } from "@/modules/access/types";

/**
 * Les actions de l'écran de scan ne passent pas par un formulaire : elles
 * renvoient un résultat typé et ne relancent PAS le rendu de la page
 * (`ok()`/refresh) — l'écran doit répondre en moins d'une seconde.
 */
type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof ForbiddenError) return { ok: false, message: "Vous n'avez pas l'autorisation de contrôler les accès." };
  if (error instanceof BusinessError) return { ok: false, message: error.message };
  throw error;
}

const scanSchema = z.object({ credential: z.string().min(1).max(200), clientEventId: z.uuid() });

export async function checkAccessAction(credential: string, clientEventId: string): Promise<ActionResult<ScanResult>> {
  try {
    const ctx = await requireActionContext("access.scan");
    const input = scanSchema.safeParse({ credential, clientEventId });
    if (!input.success) return { ok: false, message: "Code illisible." };
    const data = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      checkAccess(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, input.data),
    );
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function accessSnapshotAction(): Promise<ActionResult<AccessSnapshot>> {
  try {
    const ctx = await requireActionContext("access.scan");
    return { ok: true, data: await withTenant(ctx.tenant.id, ctx.user.id, (tx) => accessSnapshot(tx, ctx.tenant.id)) };
  } catch (error) {
    return failure(error);
  }
}

const offlineEventSchema = z.object({
  clientEventId: z.uuid(),
  memberId: z.uuid().nullable(),
  subscriptionId: z.uuid().nullable(),
  method: z.enum(["QR", "BADGE"]),
  granted: z.boolean(),
  reason: z.enum([
    "GRANTED",
    "INVALID_CODE",
    "EXPIRED_CODE",
    "UNKNOWN_BADGE",
    "MEMBER_ARCHIVED",
    "MEMBER_SUSPENDED",
    "NO_SUBSCRIPTION",
    "SUBSCRIPTION_EXPIRED",
    "NOT_STARTED",
    "PAYMENT_PENDING",
    "SUBSCRIPTION_FROZEN",
    "SUBSCRIPTION_CANCELLED",
    "DAY_NOT_ALLOWED",
    "OUTSIDE_HOURS",
    "GYM_CLOSED",
    "QUOTA_REACHED",
    "PASSBACK",
  ]),
  occurredAt: z.iso.datetime(),
});

export async function syncAccessEventsAction(
  events: unknown,
): Promise<ActionResult<{ received: number; inserted: number; rejected: number }>> {
  try {
    const ctx = await requireActionContext("access.scan");
    const parsed = z.array(offlineEventSchema).max(500).safeParse(events);
    if (!parsed.success) return { ok: false, message: "File de synchronisation invalide." };
    const data = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      syncOfflineEvents(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data),
    );
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

// --- Badges ------------------------------------------------------------------

export type BadgeFormState = FormState & { badge?: { code: string; svg: string } };

const memberIdSchema = z.object({ memberId: z.uuid({ error: "Adhérent introuvable." }) });

export async function issueBadgeAction(_prev: BadgeFormState, formData: FormData): Promise<BadgeFormState> {
  try {
    const ctx = await requireActionContext("members.write");
    const parsed = parseForm(memberIdSchema, formData);
    if (parsed.state) return parsed.state;
    const { code } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      issueBadge(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.memberId),
    );
    const svg = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { ...ok("Badge émis : imprimez-le maintenant, le code ne sera plus affiché."), badge: { code, svg } };
  } catch (error) {
    return toFormState(error);
  }
}

export async function revokeBadgeAction(_prev: BadgeFormState, formData: FormData): Promise<BadgeFormState> {
  try {
    const ctx = await requireActionContext("members.write");
    const parsed = parseForm(memberIdSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      revokeBadge(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.memberId),
    );
    return ok("Badge révoqué : il est refusé dès maintenant.");
  } catch (error) {
    return toFormState(error);
  }
}

// --- Réglages ----------------------------------------------------------------

const accessSettingsSchema = z.object({
  antiPassbackMinutes: z.coerce
    .number({ error: "Valeur invalide." })
    .int("Nombre entier de minutes.")
    .min(0, "0 minimum (désactivé).")
    .max(720, "720 minutes (12 h) maximum."),
});

export async function updateAccessSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("tenant.settings.manage");
    const parsed = parseForm(accessSettingsSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
      updateAccessSettings(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id }, parsed.data.antiPassbackMinutes),
    );
    return ok("Réglages du contrôle d'accès enregistrés.");
  } catch (error) {
    return toFormState(error);
  }
}
