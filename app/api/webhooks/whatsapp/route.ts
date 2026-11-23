import { timingSafeEqual } from "node:crypto";
import { InvalidSignatureError, processWhatsappWebhook } from "@/modules/messaging/messaging.service";

/**
 * Webhook WhatsApp Cloud API (Meta).
 *  - GET : vérification lors de la configuration (hub.verify_token).
 *  - POST : statuts de livraison et réponses des adhérents (« STOP »),
 *    signés par Meta (X-Hub-Signature-256). Une signature invalide → 401.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  const received = url.searchParams.get("hub.verify_token") ?? "";
  if (
    expected &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const summary = await processWhatsappWebhook(rawBody, request.headers.get("x-hub-signature-256"));
    return Response.json(summary);
  } catch (error) {
    if (error instanceof InvalidSignatureError) return Response.json({ error: "Signature invalide." }, { status: 401 });
    if (error instanceof SyntaxError) return Response.json({ error: "Corps invalide." }, { status: 400 });
    // Erreur temporaire : Meta renverra la notification.
    return Response.json({ error: "Erreur temporaire." }, { status: 500 });
  }
}
