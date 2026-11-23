import { timingSafeEqual } from "node:crypto";
import { runAllNotifications } from "@/modules/notifications/notifications.service";

/**
 * Rappels d'échéance (J-7, J-3, J0) et envoi des e-mails en attente, à
 * appeler toutes les heures par un planificateur avec l'en-tête
 * « Authorization: Bearer <CRON_SECRET> ». Idempotent : un rappel déjà
 * envoyé ne repart jamais.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  return Response.json(await runAllNotifications());
}
