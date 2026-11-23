import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Couche prestataires de paiement (section 11.1 du cahier des charges) :
 * chaque prestataire a son adaptateur ; changer d'agrégateur ne touche
 * jamais le reste de l'application.
 *
 * Adaptateurs disponibles :
 *  - sandbox : simulateur local signé HMAC, INTERDIT en production.
 * À ajouter avec les clés du prestataire choisi : cinetpay, paydunya, wave…
 */

export type ProviderStatus = "SUCCEEDED" | "FAILED" | "PENDING";

export type WebhookEvent = {
  eventId: string;
  providerRef: string;
  status: ProviderStatus;
  amountXof: number | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  /** Crée la transaction chez le prestataire ; renvoie l'URL de paiement. */
  initiate(input: {
    paymentId: string;
    amountXof: number;
    description: string;
    customer: { name: string; phone: string; email: string | null };
    returnUrl: string;
    notifyUrl: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  /** Vérifie la signature et décode la notification ; lève InvalidWebhookError sinon. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  /** Statut réel côté prestataire (rapprochement des paiements en attente). */
  fetchStatus(providerRef: string): Promise<{ status: ProviderStatus; amountXof: number | null }>;
}

export class InvalidWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookError";
  }
}

// --- Simulateur ----------------------------------------------------------------

const sandboxSecret = () => process.env.PAYMENT_SANDBOX_SECRET || "zahfit-sandbox-dev-secret";

export function signSandboxPayload(rawBody: string): string {
  return createHmac("sha256", sandboxSecret()).update(rawBody).digest("hex");
}

const sandbox: PaymentProvider = {
  id: "sandbox",
  label: "Simulateur de paiement (test)",
  async initiate({ paymentId }) {
    const providerRef = `SBX-${paymentId}`;
    return { providerRef, checkoutUrl: `/paiement-test/${encodeURIComponent(providerRef)}` };
  },
  async verifyWebhook(rawBody, headers) {
    const received = Buffer.from(headers.get("x-zahfit-signature") ?? "", "utf8");
    const expected = Buffer.from(signSandboxPayload(rawBody), "utf8");
    // Comparaison à temps constant : ne révèle pas la signature par chronométrage.
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new InvalidWebhookError("Signature invalide.");
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const status = body.status;
    if (
      typeof body.eventId !== "string" ||
      typeof body.providerRef !== "string" ||
      (status !== "SUCCEEDED" && status !== "FAILED" && status !== "PENDING")
    ) {
      throw new InvalidWebhookError("Notification incomplète.");
    }
    return {
      eventId: body.eventId,
      providerRef: body.providerRef,
      status,
      amountXof: typeof body.amountXof === "number" ? body.amountXof : null,
      raw: body,
    };
  },
  // Le simulateur n'a pas d'API de consultation : seul le webhook confirme,
  // et le rapprochement fait expirer les tentatives abandonnées.
  async fetchStatus() {
    return { status: "PENDING", amountXof: null };
  },
};

const PROVIDERS: Record<string, PaymentProvider> = { sandbox };

export function getProvider(id: string): PaymentProvider | null {
  return PROVIDERS[id] ?? null;
}

/** Prestataire utilisé pour les paiements en ligne (variable PAYMENT_PROVIDER). */
export function activeOnlineProvider(): PaymentProvider | null {
  const production = process.env.NODE_ENV === "production";
  const id = process.env.PAYMENT_PROVIDER || (production ? "" : "sandbox");
  if (id === "sandbox" && production) return null; // jamais de simulateur en production
  return getProvider(id);
}

export const isSandboxEnabled = () => activeOnlineProvider()?.id === "sandbox";
