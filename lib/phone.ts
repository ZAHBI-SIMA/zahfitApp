/**
 * Numéros de téléphone : stockés en E.164 (+2250701020304), clé de
 * dédoublonnage des adhérents. La Côte d'Ivoire est passée à 10 chiffres
 * en 2021 (ex. 07 01 02 03 04).
 */

const CI_PREFIX = "+225";

/** Retourne le numéro au format E.164, ou null s'il est invalide. */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);

  // Numéro ivoirien saisi localement : 10 chiffres commençant par 0.
  if (!international) {
    return digits.length === 10 && digits.startsWith("0") ? `${CI_PREFIX}${digits}` : null;
  }
  // Indicatif ivoirien : exactement 10 chiffres derrière 225.
  if (digits.startsWith("225")) return digits.length === 13 ? `+${digits}` : null;
  // Autre pays : 8 à 15 chiffres au total (norme E.164).
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** +2250701020304 → « 07 01 02 03 04 » (numéros ivoiriens), sinon tel quel. */
export function formatPhone(e164: string): string {
  if (e164.startsWith(CI_PREFIX) && e164.length === 14) {
    return e164.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ");
  }
  return e164;
}

/** Chiffres d'une recherche (« 07 01 » → « 0701 »), si assez longs pour être utiles. */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}
