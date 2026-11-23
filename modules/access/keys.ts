import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { BADGE_ALPHABET, deriveMemberKey, toBase64Url } from "@/modules/access/token";

/**
 * Clés du contrôle d'accès — SERVEUR UNIQUEMENT. La clé maîtresse ne quitte
 * jamais le serveur ; seules des clés dérivées, limitées à une salle et à
 * un jour, sont confiées aux appareils (voir modules/access/token.ts).
 */

const DEV_SECRET = "zahfit-access-dev-secret";

function masterSecret(): string {
  const secret = process.env.ACCESS_QR_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ACCESS_QR_SECRET doit être défini en production.");
  }
  return DEV_SECRET;
}

/** Jour UTC « AAAA-MM-JJ » décalé de `offset` jours. */
export const utcDay = (now: Date, offset = 0) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** Clé du jour d'une salle (base64url). */
export function tenantDayKey(tenantId: string, day: string): string {
  return toBase64Url(createHmac("sha256", masterSecret()).update(`zahfit-access:${tenantId}:${day}`).digest());
}

/**
 * Clés confiées à un appareil : aujourd'hui et demain, pour qu'un QR
 * affiché ou vérifié juste avant minuit reste valable après.
 */
export function tenantDayKeys(tenantId: string, now: Date): Record<string, string> {
  return Object.fromEntries([0, 1].map((o) => utcDay(now, o)).map((day) => [day, tenantDayKey(tenantId, day)]));
}

export async function memberDayKeys(tenantId: string, memberId: string, now: Date): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(tenantDayKeys(tenantId, now)).map(async ([day, key]) => [day, await deriveMemberKey(key, memberId)]),
  );
  return Object.fromEntries(entries);
}

/** Nouveau code de badge : ZB- + 10 caractères (≈ 50 bits d'aléa). */
export function generateBadgeCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += BADGE_ALPHABET[randomInt(BADGE_ALPHABET.length)];
  return `ZB-${code}`;
}
