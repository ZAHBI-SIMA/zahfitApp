import * as z from "zod";
import { normalizePhone } from "@/lib/phone";
import { checkbox, optionalEmail, requiredText } from "@/lib/validation";

export const phoneField = z
  .string({ error: "Le téléphone est obligatoire." })
  .trim()
  .min(1, "Le téléphone est obligatoire.")
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Numéro invalide (ex. 07 01 02 03 04 ou +33 6…)." });
      return z.NEVER;
    }
    return phone;
  });

const birthDateField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date > new Date()) {
      ctx.addIssue({ code: "custom", message: "Date de naissance invalide." });
      return z.NEVER;
    }
    return date;
  });

export const memberInputSchema = z.object({
  firstName: requiredText("Le prénom", 80),
  lastName: requiredText("Le nom", 80),
  phone: phoneField,
  email: optionalEmail,
  birthDate: birthDateField,
  consentWhatsapp: checkbox,
  consentSms: checkbox,
  consentEmail: checkbox,
});

export type MemberInput = z.infer<typeof memberInputSchema>;

/** Les deux listes d'adhérents de l'application (admin et réception). */
export const MEMBER_BASE_PATHS = ["/admin/adherents", "/reception/adherents"] as const;
export type MemberBasePath = (typeof MEMBER_BASE_PATHS)[number];

export function parseBasePath(value: FormDataEntryValue | null): MemberBasePath {
  return MEMBER_BASE_PATHS.find((p) => p === value) ?? "/admin/adherents";
}
