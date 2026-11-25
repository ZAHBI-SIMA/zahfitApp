import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { SaasFeature } from "@/lib/generated/prisma/enums";
import { checkbox, optionalText, requiredText } from "@/lib/validation";
import { SAAS_FEATURES, featureUnavailableMessage } from "@/modules/saas/features";

/**
 * Forfaits ZAHFIT : fonctionnalités et limites d'une salle, mesure de son
 * usage. Les limites ne bloquent que les NOUVELLES créations : après une
 * rétrogradation, rien n'est supprimé ni masqué dans les données.
 */

const planSelect = {
  id: true,
  code: true,
  name: true,
  features: true,
  maxMembers: true,
  maxStaff: true,
  maxWhatsappPerMonth: true,
} as const;

export async function tenantPlan(tx: Tx, tenantId: string) {
  const { saasPlan } = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { saasPlan: { select: planSelect } },
  });
  return { ...saasPlan, features: saasPlan.features ?? [] };
}

export async function tenantHasFeature(tx: Tx, tenantId: string, feature: SaasFeature) {
  return (await tenantPlan(tx, tenantId)).features.includes(feature);
}

export async function assertTenantFeature(tx: Tx, tenantId: string, feature: SaasFeature) {
  const plan = await tenantPlan(tx, tenantId);
  if (!plan.features.includes(feature)) throw new BusinessError(featureUnavailableMessage(feature, plan.name));
}

// --- Limites -----------------------------------------------------------------------

const lockTenant = (tx: Tx, tenantId: string) =>
  tx.$executeRaw`SELECT 1 FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

/**
 * Adhérents ACTIFS (les archivés ne comptent pas : archiver libère une place).
 * Appelé alors que la ligne de la salle est verrouillée (réservation des codes
 * adhérents) : deux inscriptions simultanées ne dépassent pas la limite.
 */
export async function assertMemberCapacity(tx: Tx, tenantId: string, adding: number) {
  const plan = await tenantPlan(tx, tenantId);
  if (plan.maxMembers === null) return;
  const current = await tx.member.count({ where: { tenantId, status: { not: "ARCHIVED" } } });
  if (current + adding > plan.maxMembers) {
    const left = Math.max(0, plan.maxMembers - current);
    throw new BusinessError(
      `Limite du forfait ${plan.name} : ${plan.maxMembers} adhérents actifs (${left} place(s) restante(s)). ` +
        "Archivez d'anciens adhérents ou contactez ZahDigit pour changer de forfait.",
    );
  }
}

/** Comptes du personnel actifs (adhérents exclus). */
export async function assertStaffCapacity(tx: Tx, tenantId: string) {
  const plan = await tenantPlan(tx, tenantId);
  if (plan.maxStaff === null) return;
  await lockTenant(tx, tenantId);
  const current = await tx.tenantMembership.count({
    where: { tenantId, status: "ACTIVE", role: { not: "MEMBER" } },
  });
  if (current + 1 > plan.maxStaff) {
    throw new BusinessError(
      `Limite du forfait ${plan.name} : ${plan.maxStaff} comptes pour l'équipe. ` +
        "Désactivez un accès ou contactez ZahDigit pour changer de forfait.",
    );
  }
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // Abidjan = UTC

/** Messages WhatsApp encore possibles ce mois-ci (null : illimité). Les échecs ne comptent pas. */
export async function whatsappRemaining(tx: Tx, tenantId: string, now = new Date()) {
  const plan = await tenantPlan(tx, tenantId);
  if (!plan.features.includes("MESSAGING")) return 0;
  if (plan.maxWhatsappPerMonth === null) return null;
  const used = await tx.message.count({
    where: { tenantId, channel: "WHATSAPP", status: { not: "FAILED" }, createdAt: { gte: monthStart(now) } },
  });
  return Math.max(0, plan.maxWhatsappPerMonth - used);
}

// --- Usage ---------------------------------------------------------------------

/** Usage d'une salle rapporté à son forfait (écran « Mon forfait », Super Admin). */
export async function tenantUsage(tx: Tx, tenantId: string, now = new Date()) {
  const plan = await tenantPlan(tx, tenantId);
  const from = monthStart(now);
  const members = await tx.member.count({ where: { tenantId, status: { not: "ARCHIVED" } } });
  const staff = await tx.tenantMembership.count({ where: { tenantId, status: "ACTIVE", role: { not: "MEMBER" } } });
  const messages = await tx.message.groupBy({
    by: ["channel"],
    where: { tenantId, status: { not: "FAILED" }, createdAt: { gte: from } },
    _count: { _all: true },
    _sum: { costXof: true },
  });
  const count = (channel: "WHATSAPP" | "SMS") => messages.find((m) => m.channel === channel)?._count._all ?? 0;
  return {
    plan,
    members: { used: members, limit: plan.maxMembers },
    staff: { used: staff, limit: plan.maxStaff },
    whatsapp: { used: count("WHATSAPP"), limit: plan.features.includes("MESSAGING") ? plan.maxWhatsappPerMonth : 0 },
    sms: count("SMS"),
    messagingCostXof: messages.reduce((s, m) => s + (m._sum.costXof ?? 0), 0),
  };
}

export type TenantUsage = Awaited<ReturnType<typeof tenantUsage>>;

/** Part utilisée (0-100), null si illimité. */
export const usageRatio = (used: number, limit: number | null) =>
  limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));

// --- Gestion des forfaits (Super Admin, contexte plateforme) ----------------------

const optionalLimit = (min: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? Number(v.replace(/[^\d]/g, "")) : null))
    .refine((n) => n === null || (Number.isInteger(n) && n >= min && n <= 1_000_000), "Limite invalide.");

const amount = (label: string) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .transform((v) => v.replace(/[^\d]/g, ""))
    .refine((v) => v.length > 0, `${label} est obligatoire.`)
    .transform(Number)
    .refine((n) => n <= 100_000_000, `${label} invalide.`);

export const saasPlanSchema = z.object({
  name: requiredText("Le nom", 40),
  description: optionalText(300),
  monthlyPriceXof: amount("Le prix mensuel"),
  setupFeeXof: amount("Les frais d'installation"),
  features: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(SAAS_FEATURES))),
  maxMembers: optionalLimit(0),
  maxStaff: optionalLimit(1),
  maxWhatsappPerMonth: optionalLimit(0),
  isActive: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});

export const newSaasPlanSchema = saasPlanSchema.extend({
  code: z
    .string({ error: "Le code est obligatoire." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, "Code : lettres majuscules, chiffres et _ (ex. PREMIUM_PLUS)."),
});

export function listSaasPlans(tx: Tx) {
  return tx.saasPlan.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { monthlyPriceXof: "asc" }],
    include: { _count: { select: { tenants: true } } },
  });
}

export async function createSaasPlan(tx: Tx, actorId: string, input: z.infer<typeof newSaasPlanSchema>) {
  if (await tx.saasPlan.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new BusinessError("Ce code de forfait existe déjà.", "code");
  }
  const plan = await tx.saasPlan.create({ data: input });
  await audit(tx, {
    actorUserId: actorId,
    action: "saas_plan.create",
    entityType: "saas_plan",
    entityId: plan.id,
    after: { code: plan.code, monthlyPriceXof: plan.monthlyPriceXof, features: plan.features },
  });
  return plan;
}

/**
 * Modification d'un forfait : s'applique immédiatement à toutes les salles qui
 * l'ont. Retiré de la vente (isActive = false), il reste valable pour elles.
 */
export async function updateSaasPlan(tx: Tx, actorId: string, planId: string, input: z.infer<typeof saasPlanSchema>) {
  const before = await tx.saasPlan.findUnique({ where: { id: planId } });
  if (!before) throw new BusinessError("Forfait introuvable.");
  const plan = await tx.saasPlan.update({ where: { id: planId }, data: input });
  const limits = (p: typeof plan) => ({
    monthlyPriceXof: p.monthlyPriceXof,
    features: p.features,
    maxMembers: p.maxMembers,
    maxStaff: p.maxStaff,
    maxWhatsappPerMonth: p.maxWhatsappPerMonth,
    isActive: p.isActive,
  });
  await audit(tx, {
    actorUserId: actorId,
    action: "saas_plan.update",
    entityType: "saas_plan",
    entityId: planId,
    before: limits(before),
    after: limits(plan),
  });
  return plan;
}

/** Changement de forfait d'une salle (Super Admin). Garanti côté base : une salle ne peut pas le faire elle-même. */
export async function changeTenantPlan(tx: Tx, actorId: string, tenantId: string, planId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { saasPlan: { select: { id: true, code: true } } },
  });
  if (!tenant) throw new BusinessError("Salle introuvable.");
  const plan = await tx.saasPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new BusinessError("Forfait introuvable.");
  if (plan.id === tenant.saasPlan.id) return plan;
  if (!plan.isActive) throw new BusinessError("Ce forfait n'est plus proposé.");
  await tx.tenant.update({ where: { id: tenantId }, data: { saasPlanId: plan.id } });
  await audit(tx, {
    tenantId,
    actorUserId: actorId,
    action: "tenant.plan.change",
    entityType: "tenant",
    entityId: tenantId,
    before: { plan: tenant.saasPlan.code },
    after: { plan: plan.code },
  });
  return plan;
}

/** Usage de toutes les salles (Super Admin) : base du suivi des coûts d'exploitation. */
export async function platformUsage(tx: Tx, now = new Date()) {
  const tenants = await tx.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
  const usage = new Map<string, TenantUsage>();
  for (const t of tenants) usage.set(t.id, await tenantUsage(tx, t.id, now));
  return usage;
}
