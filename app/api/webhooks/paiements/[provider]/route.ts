import { afterOnlineConfirmation } from "@/modules/payments/online.followup";
import { processWebhook } from "@/modules/payments/online.service";
import { InvalidWebhookError } from "@/modules/payments/providers";

/**
 * Notification serveur du prestataire (seule source de vérité d'un paiement
 * en ligne). Réponses : 200 traité ou doublon, 401 signature invalide,
 * 500 erreur temporaire (le prestataire renverra la notification).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/webhooks/paiements/[provider]">) {
  const { provider } = await params;
  const rawBody = await request.text(); // corps BRUT : la signature porte sur ces octets exacts
  try {
    const result = await processWebhook(provider, rawBody, request.headers);
    if (result.outcome === "unknown_provider") return Response.json({ error: "Prestataire inconnu." }, { status: 404 });
    if (result.outcome === "confirmed" && result.tenantId && result.receiptId && result.memberId) {
      await afterOnlineConfirmation(result.tenantId, result.receiptId, result.memberId);
    }
    return Response.json({ received: true, outcome: result.outcome });
  } catch (error) {
    if (error instanceof InvalidWebhookError) return Response.json({ error: error.message }, { status: 401 });
    console.error("[webhook] erreur de traitement", error instanceof Error ? error.message : error);
    return Response.json({ error: "Erreur temporaire." }, { status: 500 });
  }
}
