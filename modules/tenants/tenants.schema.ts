import * as z from "zod";
import { normalizePhone } from "@/lib/phone";
import { optionalEmail, optionalText, requiredEmail, requiredText } from "@/lib/validation";

export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABELS: Record<Day, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};
/** « 06:00-22:00 », ou null = fermé. */
export type OpeningHours = Record<Day, string | null>;

export const SOCIAL_KEYS = ["facebook", "instagram", "tiktok", "website"] as const;
export type Socials = Partial<Record<(typeof SOCIAL_KEYS)[number], string>>;

/** « Salle Pilote Cocody » → « salle-pilote-cocody » */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => SLUG_RE.test(v), "3 à 40 caractères : lettres minuscules, chiffres et tirets.");

const optionalPhone = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value?.trim()) return null;
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Numéro invalide." });
      return z.NEVER;
    }
    return phone;
  });

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/\S+\.\S+/.test(v), "Adresse web invalide (commence par https://).")
  .transform((v) => (v ? v : null));

const tenantIdentity = {
  name: requiredText("Le nom de la salle", 80),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(200),
  commune: optionalText(80),
  city: optionalText(80),
};

/** Super Admin : création d'une salle + de son administrateur. */
export const tenantCreateSchema = z.object({
  ...tenantIdentity,
  slug: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(slugField.optional()),
  adminName: requiredText("Le nom de l'administrateur", 80),
  adminEmail: requiredEmail,
});
export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;

/** Super Admin : identité de la salle (le slug n'est modifiable que par lui). */
export const tenantUpdateSchema = z.object({ ...tenantIdentity, slug: slugField });
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;

/** Administrateur de salle : fiche publique de l'établissement. */
export const tenantSettingsSchema = z.object({
  ...tenantIdentity,
  description: optionalText(1000),
  facebook: optionalUrl,
  instagram: optionalUrl,
  tiktok: optionalUrl,
  website: optionalUrl,
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Lit les horaires du formulaire : champs open_<jour>, close_<jour>,
 * closed_<jour>. Renvoie les horaires ou les erreurs par jour.
 */
export function parseOpeningHours(formData: FormData): { hours: OpeningHours; errors: Record<string, string[]> } {
  const hours = {} as OpeningHours;
  const errors: Record<string, string[]> = {};
  for (const day of DAYS) {
    if (formData.get(`closed_${day}`) === "on") {
      hours[day] = null;
      continue;
    }
    const open = String(formData.get(`open_${day}`) ?? "");
    const close = String(formData.get(`close_${day}`) ?? "");
    if (!TIME_RE.test(open) || !TIME_RE.test(close) || open >= close) {
      errors[`hours_${day}`] = [`${DAY_LABELS[day]} : horaires invalides (ouverture avant fermeture).`];
      continue;
    }
    hours[day] = `${open}-${close}`;
  }
  return { hours, errors };
}

export function readOpeningHours(value: unknown): OpeningHours {
  const fallback = Object.fromEntries(DAYS.map((d) => [d, d === "dim" ? null : "06:00-22:00"])) as OpeningHours;
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  return Object.fromEntries(
    DAYS.map((d) => [d, typeof v[d] === "string" ? (v[d] as string) : v[d] === null ? null : fallback[d]]),
  ) as OpeningHours;
}

export function readSocials(value: unknown): Socials {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return Object.fromEntries(
    SOCIAL_KEYS.filter((k) => typeof v[k] === "string").map((k) => [k, v[k] as string]),
  ) as Socials;
}
