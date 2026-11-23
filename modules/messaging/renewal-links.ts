import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "@/lib/db";

/**
 * Liens de renouvellement en un clic, envoyés dans les rappels d'échéance.
 * Jeton aléatoire de 256 bits ; la base n'en garde que l'empreinte SHA-256
 * (une fuite de la base ne donne aucun lien utilisable). Usage unique :
 * le lien est consommé quand le paiement du renouvellement est confirmé.
 */

export const RENEWAL_LINK_DAYS = 14;
const DAY_MS = 86_400_000;

export const renewalTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Crée un lien et renvoie son chemin public (/s/<salle>/renouveler/<jeton>). */
export async function createRenewalLink(
  tx: Tx,
  tenantId: string,
  subscription: { id: string; memberId: string },
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.renewalLink.create({
    data: {
      tenantId,
      memberId: subscription.memberId,
      subscriptionId: subscription.id,
      tokenHash: renewalTokenHash(token),
      expiresAt: new Date(now.getTime() + RENEWAL_LINK_DAYS * DAY_MS),
    },
  });
  const { slug } = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
  return `/s/${slug}/renouveler/${token}`;
}

export type RenewalLinkState = "valid" | "expired" | "used" | "unknown";

/** Lien, formule proposée et adhérent ; à lire dans le contexte RLS de la salle. */
export async function findRenewalLink(tx: Tx, token: string, now: Date = new Date()) {
  const link = await tx.renewalLink.findUnique({
    where: { tokenHash: renewalTokenHash(token) },
    include: {
      member: { select: { id: true, firstName: true, status: true } },
      subscription: {
        select: {
          id: true,
          planName: true,
          endDate: true,
          plan: {
            select: { id: true, name: true, priceXof: true, isActive: true, durationValue: true, durationUnit: true },
          },
        },
      },
    },
  });
  const state: RenewalLinkState = !link ? "unknown" : link.usedAt ? "used" : link.expiresAt <= now ? "expired" : "valid";
  return { link, state };
}
