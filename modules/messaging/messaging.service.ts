import { audit } from "@/lib/audit";
import { withDbContext, type Tx } from "@/lib/db";
import type { MessageChannel, MessageStatus, NotificationType } from "@/lib/generated/prisma/enums";
import {
  PermanentSendError,
  parseUnsubscribeToken,
  providerFor,
  unsubscribeToken,
  verifyWhatsappSignature,
} from "@/modules/messaging/providers";
import { CHANNEL_TEMPLATES, maskPhone, renderTemplateBody } from "@/modules/messaging/templates";
import type { TemplateData } from "@/modules/notifications/templates";
import { tenantHasFeature, whatsappRemaining } from "@/modules/saas/saas.service";

/**
 * WhatsApp et SMS : choix du canal, file d'envoi, repli SMS, statuts,
 * désinscription et coûts.
 *
 * Règle des consentements (section 8 du cahier des charges) :
 *  - WhatsApp seulement si la salle l'a activé ET que l'adhérent y a consenti ;
 *  - sinon SMS, aux mêmes conditions ;
 *  - un WhatsApp en échec bascule en SMS de secours seulement si l'adhérent
 *    a AUSSI consenti au SMS ;
 *  - « STOP » ou le lien de désinscription retire le consentement, tracé.
 */

const MAX_ATTEMPTS = 3;
const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
const absolute = (path: string) => `${appUrl()}${path}`;

type StoredVariables = { type: NotificationType; data: TemplateData; params: string[] };
type Recipient = { id: string; phone: string; consentWhatsapp: boolean; consentSms: boolean };

function content(channel: MessageChannel, type: NotificationType, data: TemplateData, tenantId: string, memberId: string) {
  const template = CHANNEL_TEMPLATES[type]!;
  if (channel === "WHATSAPP") {
    const params = template.params(data, absolute);
    return { template: template.name, params, body: renderTemplateBody(template, params) };
  }
  // Le SMS n'a pas de bouton « bloquer » : chaque SMS porte son lien de désinscription.
  const stop = absolute(`/desinscription/${unsubscribeToken(tenantId, memberId, "SMS")}`);
  return { template: `sms_${template.name}`, params: [], body: `${template.sms(data, absolute)} STOP : ${stop}` };
}

async function createQueued(
  tx: Tx,
  tenantId: string,
  input: {
    channel: MessageChannel;
    member: Recipient;
    type: NotificationType;
    data: TemplateData;
    notificationId: string | null;
    fallbackOfId?: string;
  },
) {
  const provider = providerFor(input.channel);
  if (!provider) return null;
  const c = content(input.channel, input.type, input.data, tenantId, input.member.id);
  const variables: StoredVariables = { type: input.type, data: input.data, params: c.params };
  const message = await tx.message.create({
    data: {
      tenantId,
      notificationId: input.notificationId,
      memberId: input.member.id,
      channel: input.channel,
      provider: provider.id,
      toPhone: input.member.phone,
      toMasked: maskPhone(input.member.phone),
      template: c.template,
      variables,
      body: c.body,
      fallbackOfId: input.fallbackOfId ?? null,
    },
    select: { id: true },
  });
  return message.id;
}

/**
 * Met en file le message WhatsApp ou SMS d'une notification (dans la même
 * transaction que l'événement). Rien si l'événement n'a pas de modèle, si la
 * salle n'a pas activé le canal, ou si l'adhérent n'y a pas consenti.
 */
export async function queueChannelMessage(
  tx: Tx,
  tenantId: string,
  notificationId: string,
  member: Recipient,
  type: NotificationType,
  data: TemplateData,
): Promise<string | null> {
  if (!CHANNEL_TEMPLATES[type]) return null;
  // Forfait sans WhatsApp/SMS : la notification reste dans l'application (et l'e-mail).
  if (!(await tenantHasFeature(tx, tenantId, "MESSAGING"))) return null;
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { whatsappEnabled: true, smsEnabled: true },
  });
  // Quota WhatsApp du mois atteint : repli SMS (si consenti), sinon application seule.
  const remaining = await whatsappRemaining(tx, tenantId);
  const whatsappAllowed = remaining === null || remaining > 0;
  const channel: MessageChannel | null =
    whatsappAllowed && tenant.whatsappEnabled && member.consentWhatsapp && providerFor("WHATSAPP")
      ? "WHATSAPP"
      : tenant.smsEnabled && member.consentSms && providerFor("SMS")
        ? "SMS"
        : null;
  if (!channel) return null;
  return createQueued(tx, tenantId, { channel, member, type, data, notificationId });
}

/** SMS de secours après l'échec d'un WhatsApp (consentement SMS requis). */
export async function fallbackToSms(tenantId: string, messageId: string): Promise<string | null> {
  return withDbContext({ tenantId }, async (tx) => {
    const original = await tx.message.findUnique({
      where: { id: messageId },
      select: {
        channel: true,
        notificationId: true,
        variables: true,
        fallback: { select: { id: true } },
        member: { select: { id: true, phone: true, consentWhatsapp: true, consentSms: true, status: true } },
      },
    });
    if (!original || original.channel !== "WHATSAPP" || original.fallback || !original.member) return null;
    if (original.member.status === "ARCHIVED" || !original.member.consentSms) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { smsEnabled: true } });
    if (!tenant.smsEnabled) return null;
    const v = original.variables as unknown as StoredVariables;
    return createQueued(tx, tenantId, {
      channel: "SMS",
      member: original.member,
      type: v.type,
      data: v.data,
      notificationId: original.notificationId,
      fallbackOfId: messageId,
    });
  });
}

// --- Envoi (worker) --------------------------------------------------------------

/**
 * Envoie les messages en file, HORS transaction (une API lente ne bloque pas
 * la base). 3 essais pour une erreur passagère ; un échec définitif d'un
 * WhatsApp déclenche le SMS de secours, envoyé dans la même passe.
 */
export async function flushMessages(tenantId: string | null, limit = 50) {
  const ctx = tenantId ? { tenantId } : { platform: true as const };
  const summary = { sent: 0, failed: 0, fallbacks: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const queued = await withDbContext(ctx, (tx) =>
      tx.message.findMany({
        where: { status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: {
          id: true,
          tenantId: true,
          channel: true,
          toPhone: true,
          template: true,
          body: true,
          variables: true,
          attempts: true,
        },
      }),
    );
    if (queued.length === 0) break;
    for (const m of queued) {
      const provider = providerFor(m.channel);
      let update: Record<string, unknown>;
      let failedForGood = false;
      try {
        if (!provider || !m.toPhone) throw new PermanentSendError("Aucun prestataire configuré pour ce canal");
        const params = (m.variables as unknown as StoredVariables).params;
        const result = await provider.send({ to: m.toPhone, template: m.template, params, text: m.body });
        update = {
          status: "SENT",
          provider: provider.id,
          providerMessageId: result.providerMessageId,
          costXof: result.costXof,
          sentAt: new Date(),
          attempts: m.attempts + 1,
          error: null,
        };
        summary.sent++;
      } catch (error) {
        const attempts = m.attempts + 1;
        failedForGood = error instanceof PermanentSendError || attempts >= MAX_ATTEMPTS;
        update = {
          attempts,
          error: error instanceof Error ? error.message.slice(0, 200) : "Erreur inconnue",
          ...(failedForGood ? { status: "FAILED", toPhone: null } : {}),
        };
        if (failedForGood) summary.failed++;
      }
      await withDbContext({ tenantId: m.tenantId }, (tx) => tx.message.update({ where: { id: m.id }, data: update }));
      if (failedForGood && m.channel === "WHATSAPP" && (await fallbackToSms(m.tenantId, m.id))) summary.fallbacks++;
    }
  }
  return summary;
}

// --- Statuts de livraison et réponses (webhook Meta) -----------------------------

const RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
const META_STATUS: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/**
 * Applique un statut de livraison. Jamais de retour en arrière (« lu » ne
 * redevient pas « remis ») ; un échec après remise est ignoré. Un échec
 * WhatsApp déclenche le SMS de secours.
 */
export async function applyDeliveryStatus(providerMessageId: string, rawStatus: string, error: string | null, at: Date) {
  const status = META_STATUS[rawStatus];
  if (!status) return "ignored" as const;
  const message = await withDbContext({ platform: true }, (tx) =>
    tx.message.findFirst({
      where: { providerMessageId },
      select: { id: true, tenantId: true, status: true, channel: true },
    }),
  );
  if (!message) return "unknown" as const;
  const current = message.status;
  const regress = status === "FAILED" ? current === "DELIVERED" || current === "READ" : RANK[status] <= RANK[current];
  if (current === "FAILED" || regress) return "ignored" as const;
  const final = status === "DELIVERED" || status === "READ" || status === "FAILED";
  await withDbContext({ tenantId: message.tenantId }, (tx) =>
    tx.message.update({
      where: { id: message.id },
      data: {
        status,
        ...(status === "DELIVERED" || status === "READ" ? { deliveredAt: at } : {}),
        ...(status === "FAILED" ? { error: error?.slice(0, 200) ?? "Échec signalé par le prestataire" } : {}),
        ...(final ? { toPhone: null } : {}),
      },
    }),
  );
  if (status === "FAILED" && message.channel === "WHATSAPP") await fallbackToSms(message.tenantId, message.id);
  return "applied" as const;
}

const STOP_WORDS = /^\s*(stop|arr[eê]t(er)?|d[eé]sinscri|d[eé]sabonn|unsubscribe)/i;

/**
 * Réponse « STOP » à un WhatsApp : le numéro de ZAHFIT est commun aux salles,
 * le consentement WhatsApp est donc retiré partout où ce numéro est inscrit.
 */
export async function handleInboundText(fromDigits: string, text: string): Promise<number> {
  if (!STOP_WORDS.test(text)) return 0;
  const phone = `+${fromDigits.replace(/\D/g, "")}`;
  const members = await withDbContext({ platform: true }, (tx) =>
    tx.member.findMany({ where: { phone, consentWhatsapp: true }, select: { id: true, tenantId: true } }),
  );
  for (const m of members) await optOut(m.tenantId, m.id, "WHATSAPP", "stop_reply");
  return members.length;
}

export class InvalidSignatureError extends Error {}

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id: string; status: string; timestamp?: string; errors?: { title?: string; message?: string }[] }[];
        messages?: { from: string; text?: { body?: string }; button?: { text?: string } }[];
      };
    }[];
  }[];
};

export async function processWhatsappWebhook(rawBody: string, signature: string | null) {
  if (!verifyWhatsappSignature(rawBody, signature)) throw new InvalidSignatureError();
  const payload = JSON.parse(rawBody) as MetaPayload;
  const summary = { statuses: 0, optOuts: 0 };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
        const error = s.errors?.[0] ? (s.errors[0].title ?? s.errors[0].message ?? null) : null;
        if ((await applyDeliveryStatus(s.id, s.status, error, at)) === "applied") summary.statuses++;
      }
      for (const m of change.value?.messages ?? []) {
        summary.optOuts += await handleInboundText(m.from, m.text?.body ?? m.button?.text ?? "");
      }
    }
  }
  return summary;
}

// --- Consentements ----------------------------------------------------------------

export async function optOut(tenantId: string, memberId: string, channel: MessageChannel, source: string) {
  return withDbContext({ tenantId }, async (tx) => {
    const member = await tx.member.findUnique({
      where: { id: memberId },
      select: { consentWhatsapp: true, consentSms: true },
    });
    if (!member) return false;
    const field = channel === "WHATSAPP" ? "consentWhatsapp" : "consentSms";
    if (!member[field]) return false;
    await tx.member.update({ where: { id: memberId }, data: { [field]: false, consentUpdatedAt: new Date() } });
    await audit(tx, {
      tenantId,
      action: "member.consent.optout",
      entityType: "member",
      entityId: memberId,
      after: { channel, source },
    });
    return true;
  });
}

/** Désinscription par le lien signé d'un SMS. */
export async function unsubscribeWithToken(token: string) {
  const parsed = parseUnsubscribeToken(token);
  if (!parsed) return { ok: false as const };
  await optOut(parsed.tenantId, parsed.memberId, parsed.channel, "unsubscribe_link");
  return { ok: true as const, channel: parsed.channel };
}

// --- Réglages, journal et coûts ----------------------------------------------------

export async function updateMessagingSettings(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  input: { whatsappEnabled: boolean; smsEnabled: boolean },
) {
  await tx.tenant.update({ where: { id: actor.tenantId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.messaging.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: input,
  });
}

export function listMessages(tx: Tx, take = 100) {
  return tx.message.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      channel: true,
      template: true,
      status: true,
      toMasked: true,
      costXof: true,
      error: true,
      createdAt: true,
      fallbackOfId: true,
      member: { select: { id: true, firstName: true, lastName: true, code: true } },
    },
  });
}

/** Volumes et coût d'une période, par canal (salle courante). */
export async function messagingUsage(tx: Tx, from: Date, to: Date) {
  const rows = await tx.message.groupBy({
    by: ["channel", "status"],
    where: { createdAt: { gte: from, lt: to } },
    _count: { _all: true },
    _sum: { costXof: true },
  });
  const empty = () => ({ total: 0, delivered: 0, failed: 0, costXof: 0 });
  const usage = { WHATSAPP: empty(), SMS: empty() };
  for (const r of rows) {
    const u = usage[r.channel];
    u.total += r._count._all;
    if (r.status === "DELIVERED" || r.status === "READ") u.delivered += r._count._all;
    if (r.status === "FAILED") u.failed += r._count._all;
    u.costXof += r._sum.costXof ?? 0;
  }
  return usage;
}

/** Coût des messages par salle (Super Admin, refacturation). */
export async function platformMessagingCosts(from: Date, to: Date) {
  return withDbContext({ platform: true }, async (tx) => {
    const rows = await tx.message.groupBy({
      by: ["tenantId", "channel"],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { costXof: true },
    });
    const tenants = await tx.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } },
      select: { id: true, name: true },
    });
    const name = new Map(tenants.map((t) => [t.id, t.name]));
    const byTenant = new Map<string, { tenantId: string; name: string; whatsapp: number; sms: number; costXof: number }>();
    for (const r of rows) {
      const entry = byTenant.get(r.tenantId) ?? {
        tenantId: r.tenantId,
        name: name.get(r.tenantId) ?? "—",
        whatsapp: 0,
        sms: 0,
        costXof: 0,
      };
      if (r.channel === "WHATSAPP") entry.whatsapp += r._count._all;
      else entry.sms += r._count._all;
      entry.costXof += r._sum.costXof ?? 0;
      byTenant.set(r.tenantId, entry);
    }
    return [...byTenant.values()].sort((a, b) => b.costXof - a.costXof);
  });
}
