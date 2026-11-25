import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  slugify,
  type OpeningHours,
  type TenantCreateInput,
  type TenantSettingsInput,
  type TenantUpdateInput,
} from "@/modules/tenants/tenants.schema";

async function assertSlugAvailable(tx: Tx, slug: string, exceptId?: string) {
  const existing = await tx.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== exceptId) {
    throw new BusinessError("Cet identifiant d'URL est déjà pris par une autre salle.", "slug");
  }
}

/** Contexte PLATEFORME requis (withPlatform). */
export function listTenants(tx: Tx) {
  return tx.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      commune: true,
      status: true,
      createdAt: true,
      saasPlan: { select: { name: true, maxMembers: true } },
      _count: { select: { members: true, memberships: true } },
    },
  });
}

/** Contexte PLATEFORME requis. L'utilisateur admin doit déjà exister. */
export async function createTenant(tx: Tx, actorId: string, input: TenantCreateInput, adminUserId: string) {
  const slug = input.slug ?? slugify(input.name);
  if (slug.length < 3) throw new BusinessError("Choisissez un identifiant d'URL d'au moins 3 caractères.", "slug");
  await assertSlugAvailable(tx, slug);
  const plan = await tx.saasPlan.findUnique({ where: { id: input.saasPlanId }, select: { isActive: true, code: true } });
  if (!plan?.isActive) throw new BusinessError("Choisissez un forfait proposé à la vente.", "saasPlanId");

  const tenant = await tx.tenant.create({
    data: {
      slug,
      saasPlanId: input.saasPlanId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      commune: input.commune,
      city: input.city,
    },
  });
  await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUserId, role: "ADMIN" } });
  await audit(tx, {
    tenantId: tenant.id,
    actorUserId: actorId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenant.id,
    after: { slug, name: input.name, adminEmail: input.adminEmail, plan: plan.code },
  });
  return tenant;
}

/** Contexte PLATEFORME requis. */
export async function updateTenant(tx: Tx, actorId: string, tenantId: string, input: TenantUpdateInput) {
  await assertSlugAvailable(tx, input.slug, tenantId);
  const before = await tx.tenant.findUnique({ where: { id: tenantId } });
  if (!before) throw new BusinessError("Salle introuvable.");
  await tx.tenant.update({ where: { id: tenantId }, data: input });
  await audit(tx, {
    tenantId,
    actorUserId: actorId,
    action: "tenant.update",
    entityType: "tenant",
    entityId: tenantId,
    before: { slug: before.slug, name: before.name },
    after: { slug: input.slug, name: input.name },
  });
}

/** Contexte PLATEFORME requis. Les données sont conservées pendant la suspension. */
export async function setTenantSuspended(
  tx: Tx,
  actorId: string,
  tenantId: string,
  suspended: boolean,
  reason: string | null,
) {
  if (suspended && !reason) throw new BusinessError("Indiquez le motif de la suspension.", "reason");
  await tx.tenant.update({
    where: { id: tenantId },
    data: suspended ? { status: "SUSPENDED", suspendedReason: reason } : { status: "ACTIVE", suspendedReason: null },
  });
  await audit(tx, {
    tenantId,
    actorUserId: actorId,
    action: suspended ? "tenant.suspend" : "tenant.reactivate",
    entityType: "tenant",
    entityId: tenantId,
    after: { reason },
  });
}

/** Contexte SALLE requis (withTenant) : la salle modifie sa propre fiche. */
export async function updateTenantSettings(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  input: TenantSettingsInput,
  openingHours: OpeningHours,
) {
  const { facebook, instagram, tiktok, website, ...identity } = input;
  const socials = Object.fromEntries(
    Object.entries({ facebook, instagram, tiktok, website }).filter(([, v]) => v),
  ) as Prisma.InputJsonObject;

  await tx.tenant.update({
    where: { id: actor.tenantId },
    data: { ...identity, socials, openingHours },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.settings.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: { name: identity.name },
  });
}
