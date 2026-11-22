import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { MembershipStatus, TenantRole } from "@/lib/generated/prisma/enums";
import { STAFF_ROLES } from "@/lib/labels";
import { requiredEmail, requiredText } from "@/lib/validation";

type Actor = { tenantId: string; userId: string };

const roleField = z.enum(STAFF_ROLES, { error: "Choisissez un rôle." });

export const staffInviteSchema = z.object({
  name: requiredText("Le nom", 80),
  email: requiredEmail,
  role: roleField,
});
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffRoleSchema = z.object({ membershipId: z.uuid(), role: roleField });

export function listStaff(tx: Tx, tenantId: string) {
  return tx.tenantMembership.findMany({
    where: { tenantId, role: { not: "MEMBER" } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, twoFactorEnabled: true } },
    },
  });
}

export async function addStaffMember(tx: Tx, actor: Actor, userId: string, input: StaffInviteInput) {
  const existing = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId: actor.tenantId, userId } },
    select: { role: true },
  });
  if (existing) {
    throw new BusinessError(
      existing.role === "MEMBER"
        ? "Cette adresse appartient à un adhérent de la salle."
        : "Cette personne fait déjà partie de l'équipe.",
      "email",
    );
  }
  const membership = await tx.tenantMembership.create({
    data: { tenantId: actor.tenantId, userId, role: input.role },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "staff.invite",
    entityType: "membership",
    entityId: membership.id,
    after: { email: input.email, role: input.role },
  });
  return membership;
}

/**
 * Garde-fous : on ne modifie pas son propre accès (risque de se bloquer),
 * et la salle garde toujours au moins un administrateur actif.
 */
async function loadForChange(tx: Tx, actor: Actor, membershipId: string) {
  const membership = await tx.tenantMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.role === "MEMBER") throw new BusinessError("Membre de l'équipe introuvable.");
  if (membership.userId === actor.userId) {
    throw new BusinessError("Vous ne pouvez pas modifier votre propre accès.");
  }
  return membership;
}

async function assertAnotherActiveAdmin(tx: Tx, tenantId: string, exceptMembershipId: string) {
  const others = await tx.tenantMembership.count({
    where: { tenantId, role: "ADMIN", status: "ACTIVE", id: { not: exceptMembershipId } },
  });
  if (others === 0) throw new BusinessError("La salle doit conserver au moins un administrateur actif.");
}

export async function changeStaffRole(tx: Tx, actor: Actor, membershipId: string, role: TenantRole) {
  const membership = await loadForChange(tx, actor, membershipId);
  if (membership.role === role) return;
  if (membership.role === "ADMIN") await assertAnotherActiveAdmin(tx, actor.tenantId, membershipId);
  await tx.tenantMembership.update({ where: { id: membershipId }, data: { role } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "staff.role_change",
    entityType: "membership",
    entityId: membershipId,
    before: { role: membership.role },
    after: { role },
  });
}

export async function setStaffStatus(tx: Tx, actor: Actor, membershipId: string, status: MembershipStatus) {
  const membership = await loadForChange(tx, actor, membershipId);
  if (membership.status === status) return;
  if (status === "DISABLED" && membership.role === "ADMIN") {
    await assertAnotherActiveAdmin(tx, actor.tenantId, membershipId);
  }
  await tx.tenantMembership.update({ where: { id: membershipId }, data: { status } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: status === "DISABLED" ? "staff.disable" : "staff.enable",
    entityType: "membership",
    entityId: membershipId,
  });
}
