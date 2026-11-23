import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { checkbox, optionalText, requiredText } from "@/lib/validation";

type Actor = { tenantId: string; userId: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** « 20 000 FCFA » → 20000 */
const amountField = z
  .string({ error: "Le prix est obligatoire." })
  .transform((v) => v.replace(/[^\d]/g, ""))
  .refine((v) => v.length > 0, "Le prix est obligatoire.")
  .transform(Number)
  .refine((n) => n <= 10_000_000, "Prix trop élevé.");

const optionalPositiveInt = (max: number, message: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? Number(v) : null))
    .refine((n) => n === null || (Number.isInteger(n) && n >= 1 && n <= max), message);

export const planInputSchema = z
  .object({
    name: requiredText("Le nom de la formule", 60),
    description: optionalText(300),
    priceXof: amountField,
    durationValue: z.coerce
      .number({ error: "Durée invalide." })
      .int("Durée invalide.")
      .min(1, "Durée invalide.")
      .max(1000, "Durée invalide."),
    durationUnit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"], { error: "Choisissez une unité." }),
    benefits: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      )
      .refine((list) => list.length <= 10 && list.every((b) => b.length <= 100), "10 avantages de 100 caractères maximum."),
    allowedDays: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) =>
        [...new Set((v === undefined ? [] : [v].flat()).map(Number))].filter((d) => d >= 1 && d <= 7).sort(),
      ),
    accessFrom: z.string().optional().transform((v) => v || null),
    accessUntil: z.string().optional().transform((v) => v || null),
    maxEntries: optionalPositiveInt(10_000, "Nombre d'entrées invalide."),
    maxFreezeDays: z.coerce.number().int().min(0, "Valeur invalide.").max(365, "365 jours maximum.").default(0),
    isActive: checkbox,
  })
  .superRefine((plan, ctx) => {
    const { accessFrom, accessUntil } = plan;
    if (!accessFrom && !accessUntil) return;
    if (!accessFrom || !accessUntil || !TIME_RE.test(accessFrom) || !TIME_RE.test(accessUntil) || accessFrom >= accessUntil) {
      ctx.addIssue({ code: "custom", path: ["accessFrom"], message: "Créneau invalide : renseignez début et fin (début avant fin)." });
    }
  });

export type PlanInput = z.infer<typeof planInputSchema>;

export function listPlans(tx: Tx, options: { activeOnly?: boolean } = {}) {
  return tx.membershipPlan.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { priceXof: "asc" }],
    include: { _count: { select: { subscriptions: true } } },
  });
}

export function getPlan(tx: Tx, planId: string) {
  return tx.membershipPlan.findUnique({ where: { id: planId } });
}

async function assertNameAvailable(tx: Tx, tenantId: string, name: string, exceptId?: string) {
  const existing = await tx.membershipPlan.findUnique({
    where: { tenantId_name: { tenantId, name } },
    select: { id: true },
  });
  if (existing && existing.id !== exceptId) throw new BusinessError("Une formule porte déjà ce nom.", "name");
}

export async function createPlan(tx: Tx, actor: Actor, input: PlanInput) {
  await assertNameAvailable(tx, actor.tenantId, input.name);
  const plan = await tx.membershipPlan.create({ data: { ...input, tenantId: actor.tenantId, isActive: true } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "plan.create",
    entityType: "plan",
    entityId: plan.id,
    after: { name: plan.name, priceXof: plan.priceXof, duration: `${plan.durationValue} ${plan.durationUnit}` },
  });
  return plan;
}

/**
 * Modifier une formule ne change PAS les abonnements déjà vendus : ils
 * conservent le prix et la durée figés au moment de la vente.
 */
export async function updatePlan(tx: Tx, actor: Actor, planId: string, input: PlanInput) {
  const before = await tx.membershipPlan.findUnique({ where: { id: planId } });
  if (!before) throw new BusinessError("Formule introuvable.");
  await assertNameAvailable(tx, actor.tenantId, input.name, planId);
  const after = await tx.membershipPlan.update({ where: { id: planId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "plan.update",
    entityType: "plan",
    entityId: planId,
    before: { name: before.name, priceXof: before.priceXof, isActive: before.isActive },
    after: { name: after.name, priceXof: after.priceXof, isActive: after.isActive },
  });
  return after;
}
