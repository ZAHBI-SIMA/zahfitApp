"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { toFormState } from "@/lib/actions";
import { withDbContext } from "@/lib/db";
import { parseForm, type FormState } from "@/lib/validation";
import { onlineSignupSchema, resolvePublicTenant, startOnlineSignup } from "@/modules/payments/online.service";
import { activeOnlineProvider, isSandboxEnabled, signSandboxPayload } from "@/modules/payments/providers";

const appUrl = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3100").replace(/\/$/, "");

/** Formulaire public d'inscription : crée la tentative, puis redirige vers le prestataire. */
export async function startOnlineSignupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "");
  let destination: string;
  try {
    const tenantId = await resolvePublicTenant(slug);
    if (!tenantId) return { ok: false, message: "Cette salle n'accepte pas d'inscription en ligne pour le moment." };
    const provider = activeOnlineProvider();
    if (!provider) return { ok: false, message: "Le paiement en ligne n'est pas encore disponible : inscrivez-vous à l'accueil." };

    const parsed = parseForm(onlineSignupSchema, formData);
    if (parsed.state) return parsed.state;

    const base = appUrl();
    const result = await startOnlineSignup(tenantId, parsed.data, provider, (paymentId) => ({
      returnUrl: `${base}/s/${slug}/paiement/${paymentId}`,
      notifyUrl: `${base}/api/webhooks/paiements/${provider.id}`,
    }));
    destination = result.checkoutUrl ?? `/s/${slug}`;
  } catch (error) {
    return toFormState(error);
  }
  redirect(destination);
}

/**
 * Simulateur (développement uniquement) : envoie au serveur une VRAIE
 * notification signée, comme le ferait un agrégateur, puis renvoie le client
 * sur la page de retour. Le chemin testé est donc celui de la production.
 */
export async function simulatePaymentAction(formData: FormData): Promise<void> {
  if (!isSandboxEnabled()) throw new Error("Simulateur désactivé.");
  const providerRef = String(formData.get("providerRef") ?? "");
  const outcome = formData.get("outcome") === "FAILED" ? "FAILED" : "SUCCEEDED";

  const payment = await withDbContext({ platform: true }, (tx) =>
    tx.payment.findFirst({
      where: { provider: "sandbox", providerRef },
      select: { id: true, amountXof: true, tenant: { select: { slug: true } } },
    }),
  );
  if (!payment) throw new Error("Transaction de test introuvable.");

  const body = JSON.stringify({ eventId: randomUUID(), providerRef, status: outcome, amountXof: payment.amountXof });
  await fetch(`${appUrl()}/api/webhooks/paiements/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-zahfit-signature": signSandboxPayload(body) },
    body,
  });
  redirect(`/s/${payment.tenant.slug}/paiement/${payment.id}`);
}
