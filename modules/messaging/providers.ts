import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Prestataires WhatsApp / SMS, interchangeables derrière une même interface.
 *
 *  - WhatsApp : adaptateur WhatsApp Cloud API (Meta), actif dès que
 *    WHATSAPP_TOKEN et WHATSAPP_PHONE_NUMBER_ID sont définis ; sinon
 *    simulateur en développement, rien en production.
 *  - SMS : simulateur en développement. Le fournisseur local (Orange,
 *    MTN, agrégateur…) se branchera ici, sur la même interface.
 */

export type MessagingChannel = "WHATSAPP" | "SMS";
export type SendInput = { to: string; template: string; params: string[]; text: string };
export type SendResult = { providerMessageId: string; costXof: number };

export interface MessagingProvider {
  id: string;
  channel: MessagingChannel;
  send(input: SendInput): Promise<SendResult>;
}

/** Échec définitif (numéro invalide, modèle refusé…) : inutile de réessayer. */
export class PermanentSendError extends Error {}

const production = () => process.env.NODE_ENV === "production";
const costOf = (channel: MessagingChannel) =>
  Number(channel === "WHATSAPP" ? (process.env.WHATSAPP_COST_XOF ?? 25) : (process.env.SMS_COST_XOF ?? 20));

function sandbox(channel: MessagingChannel): MessagingProvider {
  return {
    id: channel === "WHATSAPP" ? "whatsapp-sandbox" : "sms-sandbox",
    channel,
    async send({ to, template, text }) {
      // Convention du simulateur : un numéro finissant par 0000 est « injoignable ».
      if (to.endsWith("0000")) throw new PermanentSendError("Numéro injoignable (simulateur)");
      console.info(`\n[${channel === "WHATSAPP" ? "whatsapp" : "sms"}:dev] → ${to} (${template})\n  ${text}\n`);
      return {
        providerMessageId: `${channel === "WHATSAPP" ? "wa" : "sms"}-sbx-${randomUUID()}`,
        costXof: costOf(channel),
      };
    },
  };
}

const whatsappCloud: MessagingProvider = {
  id: "whatsapp-cloud",
  channel: "WHATSAPP",
  async send({ to, template, params }) {
    const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "fr" },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number } };
    if (!res.ok || !json.messages?.[0]?.id) {
      // 4xx (hors 429) : numéro ou modèle refusé, définitif. Sinon : nouvel essai.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      const message = `WhatsApp ${res.status}${json.error?.code ? ` (code ${json.error.code})` : ""}`;
      throw permanent ? new PermanentSendError(message) : new Error(message);
    }
    return { providerMessageId: json.messages[0].id, costXof: costOf("WHATSAPP") };
  },
};

export function whatsappProvider(): MessagingProvider | null {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return whatsappCloud;
  return production() ? null : sandbox("WHATSAPP");
}

export function smsProvider(): MessagingProvider | null {
  // Fournisseur SMS local à brancher : en production, aucun envoi simulé.
  return production() ? null : sandbox("SMS");
}

export const providerFor = (channel: MessagingChannel) => (channel === "WHATSAPP" ? whatsappProvider() : smsProvider());

// --- Notifications de Meta (statuts, réponses STOP) ---------------------------

const DEV_APP_SECRET = "zahfit-whatsapp-dev-secret";
const appSecret = () => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) return secret;
  if (production()) throw new Error("WHATSAPP_APP_SECRET doit être défini en production.");
  return DEV_APP_SECRET;
};

/** Signature « sha256=<hex> » calculée par Meta avec le secret de l'application. */
export function signWhatsappPayload(rawBody: string): string {
  return `sha256=${createHmac("sha256", appSecret()).update(rawBody).digest("hex")}`;
}

export function verifyWhatsappSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(signWhatsappPayload(rawBody));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// --- Liens de désinscription signés -------------------------------------------

const DEV_MESSAGING_SECRET = "zahfit-messaging-dev-secret";
const messagingSecret = () => {
  const secret = process.env.MESSAGING_SECRET;
  if (secret) return secret;
  if (production()) throw new Error("MESSAGING_SECRET doit être défini en production.");
  return DEV_MESSAGING_SECRET;
};

const signature = (payload: string) =>
  createHmac("sha256", messagingSecret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 32);

/** Jeton de désinscription : salle, adhérent et canal, signés (sans expiration : un « STOP » reste valable). */
export function unsubscribeToken(tenantId: string, memberId: string, channel: MessagingChannel): string {
  const payload = `${tenantId}.${memberId}.${channel}`;
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload)}`;
}

export function parseUnsubscribeToken(
  token: string,
): { tenantId: string; memberId: string; channel: MessagingChannel } | null {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  const [tenantId, memberId, channel] = payload.split(".");
  if (!tenantId || !memberId || (channel !== "WHATSAPP" && channel !== "SMS")) return null;
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return { tenantId, memberId, channel };
}
