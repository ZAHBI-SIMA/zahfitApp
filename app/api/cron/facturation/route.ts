import { timingSafeEqual } from "node:crypto";
import { runBillingCycle } from "@/modules/billing/billing.service";

/**
 * Facturation ZahDigit, une fois par jour (ex. 06:00) avec l'en-tête
 * « Authorization: Bearer <CRON_SECRET> » : fins d'essai, factures mensuelles,
 * relances, lecture seule et suspension pour impayé.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  return Response.json(await runBillingCycle());
}
