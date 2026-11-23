/**
 * Jetons d'accès — module ISOMORPHE (serveur ET navigateur, via WebCrypto),
 * pour que l'écran de scan puisse vérifier un QR même hors ligne.
 *
 * Hiérarchie des clés (la clé maîtresse ne quitte jamais le serveur) :
 *   clé maîtresse (env)  ──HMAC(salle, jour)──▶  clé du jour de la salle
 *   clé du jour          ──HMAC(adhérent)────▶  clé du jour de l'adhérent
 *
 *  - le téléphone de l'adhérent ne reçoit QUE sa propre clé du jour : il
 *    génère ses QR sans réseau, mais ne peut rien signer pour un autre ;
 *  - l'écran de scan reçoit la clé du jour de SA salle : il vérifie tous les
 *    QR de la salle hors ligne. Un QR d'une autre salle échoue à la signature.
 *
 * Format du QR dynamique : ZF1.<memberId>.<fenêtre>.<signature>
 * La fenêtre change toutes les 30 s ; un QR est accepté pendant 30 à 60 s.
 */

export const WINDOW_SECONDS = 30;
const SIG_LENGTH = 22; // 22 caractères base64url ≈ 128 bits
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Alphabet des badges : sans 0/O ni 1/I/L, pour être relu sans erreur. */
export const BADGE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BADGE_RE = new RegExp(`^ZB-?([${BADGE_ALPHABET}]{10})$`);

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(keyB64: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", fromBase64Url(keyB64), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Comparaison à temps constant : ne révèle pas combien de caractères sont justes. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const windowOf = (ms: number) => Math.floor(ms / 1000 / WINDOW_SECONDS);
/** Jour (UTC) auquel appartient une fenêtre : détermine la clé du jour à utiliser. */
export const dayOfWindow = (window: number) => new Date(window * WINDOW_SECONDS * 1000).toISOString().slice(0, 10);

/** Clé du jour de l'adhérent, dérivée de la clé du jour de la salle. */
export async function deriveMemberKey(dayKeyB64: string, memberId: string): Promise<string> {
  return toBase64Url(await hmac(dayKeyB64, `member:${memberId}`));
}

async function qrSignature(memberKeyB64: string, window: number): Promise<string> {
  return toBase64Url(await hmac(memberKeyB64, `qr:${window}`)).slice(0, SIG_LENGTH);
}

export async function buildQrToken(memberKeyB64: string, memberId: string, window: number): Promise<string> {
  return `ZF1.${memberId}.${window}.${await qrSignature(memberKeyB64, window)}`;
}

export type QrCredential = { kind: "qr"; memberId: string; window: number; signature: string };
export type Credential = QrCredential | { kind: "badge"; code: string };

/**
 * Reconnaît ce qui a été scanné (caméra, ou douchette USB qui « tape » le
 * contenu du code puis Entrée). Renvoie null pour tout le reste.
 */
export function parseCredential(raw: string): Credential | null {
  const text = raw.trim();
  const qr = /^ZF1\.([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(text);
  if (qr && UUID_RE.test(qr[1])) return { kind: "qr", memberId: qr[1], window: Number(qr[2]), signature: qr[3] };
  const badge = BADGE_RE.exec(text.toUpperCase().replace(/\s/g, ""));
  if (badge) return { kind: "badge", code: `ZB-${badge[1]}` };
  return null;
}

/** Vérifie la signature d'un QR avec la clé du jour de la salle. */
export async function verifyQrSignature(dayKeyB64: string, credential: QrCredential): Promise<boolean> {
  const memberKey = await deriveMemberKey(dayKeyB64, credential.memberId);
  return safeEqual(await qrSignature(memberKey, credential.window), credential.signature);
}

/**
 * Fenêtres acceptées autour de « maintenant » : la précédente (QR affiché
 * depuis moins de 60 s) et une d'avance (horloge du téléphone en avance).
 */
export function qrWindowStatus(window: number, nowMs: number): "valid" | "expired" | "future" {
  const now = windowOf(nowMs);
  if (window < now - 1) return "expired";
  if (window > now + 1) return "future";
  return "valid";
}

/** Empreinte SHA-256 d'un code de badge (seule valeur stockée en base). */
export async function badgeHash(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
