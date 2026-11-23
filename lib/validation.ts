import * as z from "zod";

/**
 * Validation des formulaires (Zod), sans dépendance à la session : partagée
 * par les schémas des modules, les Server Actions et les tests.
 */

/** État renvoyé par une Server Action de formulaire (useActionState). */
export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

/** Valide un FormData avec un schéma Zod ; renvoie les erreurs par champ. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { data: z.infer<S>; state?: undefined } | { data?: undefined; state: FormState } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    // Champs techniques ajoutés par React ($ACTION_…) ignorés.
    if (key.startsWith("$")) continue;
    // Champ répété (cases à cocher multiples) → tableau de valeurs.
    const previous = raw[key];
    raw[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  return {
    state: {
      ok: false,
      message: "Certains champs sont à corriger.",
      errors: z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    },
  };
}

export const requiredText = (label: string, max = 120) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .trim()
    .min(1, `${label} est obligatoire.`)
    .max(max, `${label} : ${max} caractères maximum.`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .optional()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .refine((v) => !v || z.email().safeParse(v).success, "Adresse e-mail invalide.")
  .transform((v) => (v ? v : null));

export const requiredEmail = z
  .string({ error: "L'adresse e-mail est obligatoire." })
  .trim()
  .toLowerCase()
  .pipe(z.email("Adresse e-mail invalide."));

/** Case à cocher HTML : présente (« on ») ou absente du FormData. */
export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
