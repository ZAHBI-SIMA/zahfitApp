import * as z from "zod";
import { audit } from "@/lib/audit";
import { prisma, withDbContext, type Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { checkbox, requiredEmail, requiredText } from "@/lib/validation";
import { createMember } from "@/modules/members/members.service";
import { phoneField } from "@/modules/members/members.schema";
import { issueReceipt, lockRow, netPaid } from "@/modules/payments/payments.service";
import { getProvider, type PaymentProvider, type ProviderStatus } from "@/modules/payments/providers";
import { findRenewalLink } from "@/modules/messaging/renewal-links";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { activateIfPaid, assignSubscription, cancelSubscription } from "@/modules/subscriptions/subscriptions.service";
import { assertTenantFeature, tenantHasFeature } from "@/modules/saas/saas.service";
import { applySaasPaymentStatus, findSaasPaymentByRef } from "@/modules/billing/billing.service";

/** Une tentative de paiement en ligne non confirmée expire au bout de 30 minutes. */
export const PAYMENT_TTL_MINUTES = 30;

// --- Page publique -----------------------------------------------------------

/** Slug → identifiant d'une salle ACTIVE (fonction SQL SECURITY DEFINER). */
export async function resolvePublicTenant(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`SELECT app.public_tenant_id(${slug}) AS id`;
  return rows[0]?.id ?? null;
}

/** Contexte « salle » sans utilisateur : visiteur public ou traitement système. */
export const inTenant = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => withDbContext({ tenantId }, fn);

export async function loadPublicTenant(slug: string) {
  const tenantId = await resolvePublicTenant(slug);
  if (!tenantId) return null;
  return inTenant(tenantId, async (tx) => ({
    tenant: await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        address: true,
        commune: true,
        city: true,
        phone: true,
        email: true,
        openingHours: true,
        socials: true,
      },
    }),
    plans: await tx.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceXof: "asc" }],
    }),
    /** Le forfait de la salle inclut-il l'inscription en ligne ? */
    onlinePayments: await tenantHasFeature(tx, tenantId, "ONLINE_PAYMENTS"),
  }));
}

// --- Inscription en ligne ----------------------------------------------------

export const onlineSignupSchema = z.object({
  planId: z.uuid({ error: "Choisissez une formule." }),
  firstName: requiredText("Le prénom", 80),
  lastName: requiredText("Le nom", 80),
  phone: phoneField,
  email: requiredEmail,
  consentWhatsapp: checkbox,
  consentSms: checkbox,
  consentEmail: checkbox,
  acceptTerms: z.literal("on", { error: "Vous devez accepter les conditions et la politique de confidentialité." }),
  /** Champ piège invisible : un robot le remplit, un humain non. */
  website: z.string().max(0, "Requête refusée.").optional(),
});
export type OnlineSignupInput = z.infer<typeof onlineSignupSchema>;

/**
 * Parcours 6.1 du cahier des charges :
 *  1. adhérent retrouvé par téléphone (ou créé, origine ONLINE) ;
 *  2. abonnement EN ATTENTE DE PAIEMENT ;
 *  3. transaction PENDING chez le prestataire ;
 *  4. l'activation n'aura lieu QUE sur notification serveur confirmée.
 */
export async function startOnlineSignup(
  tenantId: string,
  input: OnlineSignupInput,
  provider: PaymentProvider,
  urls: (paymentId: string) => { returnUrl: string; notifyUrl: string },
): Promise<{ paymentId: string | null; checkoutUrl: string | null; subscriptionId: string }> {
  const actor = { tenantId, userId: null };
  const today = todayCalendar();

  const prepared = await inTenant(tenantId, async (tx) => {
    await assertTenantFeature(tx, tenantId, "ONLINE_PAYMENTS");
    let member = await tx.member.findUnique({ where: { tenantId_phone: { tenantId, phone: input.phone } } });
    if (member?.status === "ARCHIVED") {
      throw new BusinessError("Ce numéro ne peut pas s'inscrire en ligne : contactez directement la salle.", "phone");
    }
    if (!member) {
      member = await createMember(
        tx,
        actor,
        {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email,
          birthDate: null,
          consentWhatsapp: input.consentWhatsapp,
          consentSms: input.consentSms,
          consentEmail: input.consentEmail,
        },
        "ONLINE",
      );
    }

    // Nouvelle tentative après un échec : on réutilise l'abonnement en attente
    // s'il porte sur la même formule, sinon on l'annule (rien n'a été payé).
    const pending = await tx.subscription.findFirst({ where: { memberId: member.id, status: "PENDING_PAYMENT" } });
    let subscription = pending?.planId === input.planId ? pending : null;
    if (pending && !subscription) {
      if ((await netPaid(tx, pending.id)) > 0) {
        throw new BusinessError("Un paiement est déjà en cours pour ce numéro : contactez la salle.");
      }
      await cancelSubscription(
        tx,
        actor,
        { subscriptionId: pending.id, reason: "Remplacé par une inscription en ligne" },
        { canCancelPaid: false },
      );
    }
    subscription ??= await assignSubscription(tx, actor, { memberId: member.id, planId: input.planId, startDate: null }, today);

    return { subscription, member, payment: await createPendingPayment(tx, tenantId, member.id, subscription, provider.id) };
  });
  return initiateCheckout(tenantId, prepared, provider, urls);
}

type Prepared = {
  subscription: { id: string; planName: string };
  member: { id: string; firstName: string; lastName: string; phone: string; email: string | null };
  payment: { id: string; amountXof: number } | null;
};

/** Transaction PENDING pour le solde de l'abonnement (null si déjà payé). */
async function createPendingPayment(
  tx: Tx,
  tenantId: string,
  memberId: string,
  subscription: { id: string; priceXof: number },
  providerId: string,
) {
  const balance = subscription.priceXof - (await netPaid(tx, subscription.id));
  if (balance <= 0) return null;
  const payment = await tx.payment.create({
    data: {
      tenantId,
      memberId,
      subscriptionId: subscription.id,
      amountXof: balance,
      method: "MOBILE_MONEY",
      provider: providerId,
      status: "PENDING",
      expiresAt: new Date(Date.now() + PAYMENT_TTL_MINUTES * 60_000),
    },
  });
  await audit(tx, {
    tenantId,
    action: "payment.online.start",
    entityType: "payment",
    entityId: payment.id,
    after: { provider: providerId, amountXof: balance, subscriptionId: subscription.id },
  });
  return payment;
}

async function initiateCheckout(
  tenantId: string,
  prepared: Prepared,
  provider: PaymentProvider,
  urls: (paymentId: string) => { returnUrl: string; notifyUrl: string },
): Promise<{ paymentId: string | null; checkoutUrl: string | null; subscriptionId: string }> {
  if (!prepared.payment) return { paymentId: null, checkoutUrl: null, subscriptionId: prepared.subscription.id };

  // Appel au prestataire HORS transaction : une API lente ne bloque pas la base.
  const payment = prepared.payment;
  try {
    const { returnUrl, notifyUrl } = urls(payment.id);
    const created = await provider.initiate({
      paymentId: payment.id,
      amountXof: payment.amountXof,
      description: `Abonnement ${prepared.subscription.planName}`,
      customer: {
        name: `${prepared.member.firstName} ${prepared.member.lastName}`,
        phone: prepared.member.phone,
        email: prepared.member.email,
      },
      returnUrl,
      notifyUrl,
    });
    await inTenant(tenantId, (tx) => tx.payment.update({ where: { id: payment.id }, data: { providerRef: created.providerRef } }));
    return { paymentId: payment.id, checkoutUrl: created.checkoutUrl, subscriptionId: prepared.subscription.id };
  } catch (error) {
    await inTenant(tenantId, (tx) => tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }));
    throw error instanceof BusinessError
      ? error
      : new BusinessError("Le service de paiement est indisponible. Réessayez dans un instant.");
  }
}

// --- Renouvellement en un clic ----------------------------------------------

const LINK_ERRORS = {
  unknown: "Ce lien de renouvellement n'est pas valide.",
  expired: "Ce lien de renouvellement a expiré : passez à l'accueil ou attendez le prochain rappel.",
  used: "Ce renouvellement est déjà payé. Merci !",
} as const;

/**
 * Lien reçu par WhatsApp, SMS ou e-mail : même formule, nouvel abonnement
 * à la suite de l'actuel, paiement Mobile Money. Le lien n'est consommé
 * qu'au paiement CONFIRMÉ : après un échec, l'adhérent peut réessayer.
 */
export async function startRenewal(
  tenantId: string,
  token: string,
  provider: PaymentProvider,
  urls: (paymentId: string) => { returnUrl: string; notifyUrl: string },
  now: Date = new Date(),
) {
  const actor = { tenantId, userId: null };
  const prepared = await inTenant(tenantId, async (tx) => {
    await assertTenantFeature(tx, tenantId, "ONLINE_PAYMENTS");
    const { link, state } = await findRenewalLink(tx, token, now);
    if (state !== "valid" || !link) throw new BusinessError(LINK_ERRORS[state as keyof typeof LINK_ERRORS]);
    if (link.member.status !== "ACTIVE") throw new BusinessError("Contactez la salle pour renouveler votre abonnement.");
    const plan = link.subscription.plan;
    if (!plan.isActive) throw new BusinessError("Cette formule n'est plus proposée : contactez la salle.");

    const member = await tx.member.findUniqueOrThrow({ where: { id: link.memberId } });
    let subscription = link.renewalSubscriptionId
      ? await tx.subscription.findUnique({ where: { id: link.renewalSubscriptionId } })
      : null;
    if (subscription && subscription.status !== "PENDING_PAYMENT") subscription = null;
    // Un abonnement déjà en attente (saisi à l'accueil, ou essai précédent) est réutilisé.
    subscription ??= await tx.subscription.findFirst({
      where: { memberId: member.id, planId: plan.id, status: "PENDING_PAYMENT" },
    });
    subscription ??= await assignSubscription(tx, actor, { memberId: member.id, planId: plan.id, startDate: null }, todayCalendar(now));
    await tx.renewalLink.update({ where: { id: link.id }, data: { renewalSubscriptionId: subscription.id } });
    return { subscription, member, payment: await createPendingPayment(tx, tenantId, member.id, subscription, provider.id) };
  });
  return initiateCheckout(tenantId, prepared, provider, urls);
}

// --- Confirmation par le prestataire -----------------------------------------

export type ApplyOutcome = "confirmed" | "failed" | "already" | "pending" | "amount_mismatch";

/**
 * Applique un statut prestataire à une transaction PENDING. Idempotent : une
 * transaction déjà traitée n'est jamais retouchée (pas de double reçu, même
 * avec deux notifications d'identifiants différents).
 */
export async function applyProviderStatus(
  tenantId: string,
  paymentId: string,
  status: ProviderStatus,
  amountXof: number | null,
): Promise<{ outcome: ApplyOutcome; receiptId?: string; memberId?: string }> {
  const actor = { tenantId, userId: null };
  return inTenant(tenantId, async (tx) => {
    await lockRow(tx, "payments", paymentId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status !== "PENDING") return { outcome: "already" };
    if (status === "PENDING") return { outcome: "pending" };

    if (status === "FAILED" || (amountXof !== null && amountXof !== payment.amountXof)) {
      const mismatch = status === "SUCCEEDED";
      await tx.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
      await audit(tx, {
        tenantId,
        action: mismatch ? "payment.online.amount_mismatch" : "payment.online.failed",
        entityType: "payment",
        entityId: paymentId,
        after: { expected: payment.amountXof, received: amountXof },
      });
      return { outcome: mismatch ? "amount_mismatch" : "failed" };
    }

    await tx.payment.update({ where: { id: paymentId }, data: { status: "SUCCEEDED", paidAt: new Date() } });
    const receipt = await issueReceipt(tx, tenantId, payment);
    if (payment.subscriptionId) {
      await activateIfPaid(tx, actor, payment.subscriptionId);
      // Usage unique : le lien de renouvellement qui a mené à ce paiement est consommé.
      await tx.renewalLink.updateMany({
        where: { renewalSubscriptionId: payment.subscriptionId, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    await audit(tx, {
      tenantId,
      action: "payment.online.confirmed",
      entityType: "payment",
      entityId: paymentId,
      after: { amountXof: payment.amountXof, provider: payment.provider, receipt: receipt.number },
    });
    return { outcome: "confirmed", receiptId: receipt.id, memberId: payment.memberId };
  });
}

/**
 * Traitement d'une notification serveur :
 *  1. signature vérifiée par l'adaptateur (sinon InvalidWebhookError → 401) ;
 *  2. événement enregistré AVANT traitement, clé unique (prestataire, événement) ;
 *  3. statut appliqué à la transaction correspondante.
 */
export async function processWebhook(providerId: string, rawBody: string, headers: Headers) {
  const provider = getProvider(providerId);
  if (!provider) return { outcome: "unknown_provider" as const };
  const event = await provider.verifyWebhook(rawBody, headers);

  let stored: {
    eventRowId: string;
    payment: { id: string; tenantId: string } | null;
    saas: { id: string; tenantId: string } | null;
  };
  try {
    stored = await withDbContext({ platform: true }, async (tx) => {
      const row = await tx.paymentWebhookEvent.create({
        data: {
          provider: provider.id,
          eventId: event.eventId,
          providerRef: event.providerRef,
          status: event.status,
          amountXof: event.amountXof,
          payload: event.raw as Prisma.InputJsonValue,
        },
      });
      const payment = await tx.payment.findFirst({
        where: { provider: provider.id, providerRef: event.providerRef },
        select: { id: true, tenantId: true },
      });
      // Sinon : règlement d'une facture ZahDigit par une salle (même prestataire, même webhook).
      const saas = payment ? null : await findSaasPaymentByRef(tx, provider.id, event.providerRef);
      return { eventRowId: row.id, payment, saas };
    });
  } catch (error) {
    // Même notification reçue deux fois (y compris en parallèle) : sans effet.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "duplicate" as const };
    }
    throw error;
  }

  const result = stored.payment
    ? await applyProviderStatus(stored.payment.tenantId, stored.payment.id, event.status, event.amountXof)
    : stored.saas
      ? {
          outcome: (await applySaasPaymentStatus(stored.saas.id, event.status, event.amountXof)).outcome,
          // Facture ZahDigit : pas de reçu adhérent à envoyer.
          receiptId: undefined as string | undefined,
          memberId: undefined as string | undefined,
        }
      : { outcome: "unknown_payment" as const };

  await withDbContext({ platform: true }, (tx) =>
    tx.paymentWebhookEvent.update({
      where: { id: stored.eventRowId },
      data: { processedAt: new Date(), result: result.outcome },
    }),
  );
  return { ...result, tenantId: stored.payment?.tenantId };
}

// --- Rapprochement -----------------------------------------------------------

/**
 * Filet de sécurité si une notification se perd : interroge le prestataire
 * pour les transactions en attente, puis fait expirer les tentatives
 * abandonnées. À lancer toutes les 5 minutes (cron).
 */
export async function reconcilePendingPayments(now: Date = new Date()) {
  const pending = await withDbContext({ platform: true }, (tx) =>
    tx.payment.findMany({
      where: { status: "PENDING", provider: { not: "manual" }, createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
      select: { id: true, tenantId: true, provider: true, providerRef: true, expiresAt: true },
      take: 200,
    }),
  );
  const summary = { checked: pending.length, confirmed: 0, failed: 0, expired: 0 };
  for (const p of pending) {
    const provider = getProvider(p.provider);
    if (provider && p.providerRef) {
      try {
        const remote = await provider.fetchStatus(p.providerRef);
        if (remote.status !== "PENDING") {
          const { outcome } = await applyProviderStatus(p.tenantId, p.id, remote.status, remote.amountXof);
          if (outcome === "confirmed") summary.confirmed++;
          else if (outcome === "failed" || outcome === "amount_mismatch") summary.failed++;
          continue;
        }
      } catch {
        // Prestataire injoignable : on réessaiera au prochain passage.
      }
    }
    if (p.expiresAt && p.expiresAt < now) {
      await inTenant(p.tenantId, async (tx) => {
        const updated = await tx.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "EXPIRED" } });
        if (updated.count) {
          await audit(tx, { tenantId: p.tenantId, action: "payment.online.expired", entityType: "payment", entityId: p.id });
        }
      });
      summary.expired++;
    }
  }
  return summary;
}
