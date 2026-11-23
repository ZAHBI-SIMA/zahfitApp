import { timingSafeEqual } from "node:crypto";
import { reconcilePendingPayments } from "@/modules/payments/online.service";

/**
 * Rapprochement des paiements en ligne en attente, à appeler toutes les
 * 5 minutes par un planificateur (Vercel Cron, cron système, worker…) avec
 * l'en-tête « Authorization: Bearer <CRON_SECRET> ».
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  return Response.json(await reconcilePendingPayments());
}
