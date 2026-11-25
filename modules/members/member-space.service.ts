import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { checkbox } from "@/lib/validation";
import { createRenewalLink } from "@/modules/messaging/renewal-links";
import { assertTenantFeature } from "@/modules/saas/saas.service";

/**
 * Espace adhérent : ce que l'adhérent consulte ou modifie LUI-MÊME. Chaque
 * fonction part du compte connecté (userId) : un adhérent ne peut jamais
 * viser la fiche d'un autre, même en forgeant une requête.
 */

export function myMember(tx: Tx, userId: string) {
  return tx.member.findFirst({
    where: { userId, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      code: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      consentWhatsapp: true,
      consentSms: true,
      consentEmail: true,
      createdAt: true,
    },
  });
}

/** Historique complet : achats boutique, passages et cours suivis. */
export async function memberActivity(tx: Tx, memberId: string, now: Date) {
  const purchases = await tx.sale.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      number: true,
      totalXof: true,
      status: true,
      createdAt: true,
      lines: { select: { productName: true, quantity: true } },
    },
  });
  const visits = await tx.accessLog.findMany({
    where: { memberId, granted: true },
    orderBy: { occurredAt: "desc" },
    take: 30,
    select: { id: true, occurredAt: true, method: true },
  });
  const classes = await tx.booking.findMany({
    where: { memberId, status: "CONFIRMED", session: { startsAt: { lt: now } } },
    orderBy: { session: { startsAt: "desc" } },
    take: 30,
    select: {
      id: true,
      attendance: true,
      session: { select: { startsAt: true, classType: { select: { name: true } } } },
    },
  });
  return { purchases, visits, classes };
}

export const consentsSchema = z.object({
  consentWhatsapp: checkbox,
  consentSms: checkbox,
  consentEmail: checkbox,
});

/** Consentements modifiés par l'adhérent : tracés comme toute modification de fiche. */
export async function updateMyConsents(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  input: z.infer<typeof consentsSchema>,
) {
  const member = await myMember(tx, actor.userId);
  if (!member) throw new BusinessError("Fiche adhérent introuvable.");
  await tx.member.update({ where: { id: member.id }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "member.consent.update",
    entityType: "member",
    entityId: member.id,
    before: { whatsapp: member.consentWhatsapp, sms: member.consentSms, email: member.consentEmail },
    after: { whatsapp: input.consentWhatsapp, sms: input.consentSms, email: input.consentEmail },
  });
}

/**
 * Renouvellement depuis l'espace adhérent : un lien à usage unique (même
 * parcours que celui des rappels WhatsApp/SMS) pour la dernière formule.
 */
export async function createSelfRenewalLink(tx: Tx, tenantId: string, userId: string) {
  await assertTenantFeature(tx, tenantId, "ONLINE_PAYMENTS");
  const member = await myMember(tx, userId);
  if (!member) throw new BusinessError("Fiche adhérent introuvable.");
  const last = await tx.subscription.findFirst({
    where: { memberId: member.id, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] } },
    orderBy: { endDate: "desc" },
    select: { id: true, memberId: true, plan: { select: { isActive: true } } },
  });
  if (!last) throw new BusinessError("Aucun abonnement à renouveler : choisissez une formule à l'accueil.");
  if (!last.plan.isActive) {
    throw new BusinessError("Votre formule n'est plus proposée : l'accueil vous présentera les nouvelles.");
  }
  return createRenewalLink(tx, tenantId, { id: last.id, memberId: last.memberId });
}
