import "server-only";
import { findOrCreateUser, sendActivationLinkIfNeeded } from "@/lib/invite";
import { inTenant } from "@/modules/payments/online.service";
import { sendReceiptByEmail } from "@/modules/payments/receipt-email";

/**
 * Suites d'un paiement en ligne confirmé, HORS transaction (un e-mail en
 * échec n'annule jamais un paiement) :
 *  - reçu PDF envoyé par e-mail ;
 *  - compte de l'espace adhérent créé, avec lien pour choisir son mot de passe.
 */
export async function afterOnlineConfirmation(tenantId: string, receiptId: string, memberId: string) {
  await sendReceiptByEmail({ tenantId, userId: "" }, receiptId);
  try {
    const member = await inTenant(tenantId, (tx) =>
      tx.member.findUnique({ where: { id: memberId }, select: { email: true, userId: true, firstName: true, lastName: true } }),
    );
    if (!member?.email || member.userId) return;
    const user = await findOrCreateUser(member.email, `${member.firstName} ${member.lastName}`);
    await inTenant(tenantId, async (tx) => {
      const existing = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      if (!existing) await tx.tenantMembership.create({ data: { tenantId, userId: user.id, role: "MEMBER" } });
      await tx.member.update({ where: { id: memberId }, data: { userId: user.id } });
    });
    await sendActivationLinkIfNeeded(user.id, member.email);
  } catch (error) {
    console.error("[paiement-en-ligne] création du compte adhérent impossible", error instanceof Error ? error.message : error);
  }
}
