/**
 * Sprint 5 — paiement en ligne : webhooks signés, idempotence, échec, expiration.
 * Critères du cahier des charges (section 14) :
 *  - « Activation après confirmation serveur » ;
 *  - « Paiement échoué : aucun abonnement payé ne doit être créé ».
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma } from "@/lib/db";
import { createPlan } from "@/modules/plans/plans.service";
import {
  inTenant,
  processWebhook,
  reconcilePendingPayments,
  resolvePublicTenant,
  startOnlineSignup,
} from "@/modules/payments/online.service";
import { InvalidWebhookError, getProvider, signSandboxPayload } from "@/modules/payments/providers";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const T = randomUUID();
const slug = `online-${run}`;
const sandbox = getProvider("sandbox")!;
const urls = (id: string) => ({ returnUrl: `http://test/${id}`, notifyUrl: "http://test/webhook" });
let planId = "";
let seq = 0;

function signup() {
  seq++;
  return startOnlineSignup(
    T,
    {
      planId,
      firstName: "Web",
      lastName: `Client${seq}`,
      phone: `+22501777700${String(seq).padStart(2, "0")}`,
      email: `web${seq}-${run}@test.local`,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: true,
      acceptTerms: "on",
      website: undefined,
    },
    sandbox,
    urls,
  );
}

async function notify(providerRef: string, status: "SUCCEEDED" | "FAILED", amountXof: number, eventId = randomUUID()) {
  const body = JSON.stringify({ eventId, providerRef, status, amountXof });
  return processWebhook("sandbox", body, new Headers({ "x-zahfit-signature": signSandboxPayload(body) }));
}

const paymentOf = (id: string) =>
  owner.payment.findUniqueOrThrow({ where: { id }, include: { receipt: true, subscription: true } });

beforeAll(async () => {
  await owner.tenant.create({ data: { id: T, slug, name: "Salle en ligne" } });
  planId = (
    await inTenant(T, (tx) =>
      createPlan(
        tx,
        { tenantId: T, userId: null },
        {
          name: "Mensuel",
          description: null,
          priceXof: 20_000,
          durationValue: 1,
          durationUnit: "MONTH",
          benefits: [],
          allowedDays: [],
          accessFrom: null,
          accessUntil: null,
          maxEntries: null,
          maxFreezeDays: 0,
          isActive: true,
        },
      ),
    )
  ).id;
});

afterAll(async () => {
  const refs = (await owner.payment.findMany({ where: { tenantId: T }, select: { providerRef: true } }))
    .map((p) => p.providerRef)
    .filter((r): r is string => !!r);
  await owner.receipt.deleteMany({ where: { tenantId: T } });
  await owner.payment.deleteMany({ where: { tenantId: T } });
  await owner.paymentWebhookEvent.deleteMany({ where: { providerRef: { in: refs } } });
  await owner.subscription.updateMany({ where: { tenantId: T }, data: { previousId: null } });
  await owner.subscription.deleteMany({ where: { tenantId: T } });
  await owner.member.deleteMany({ where: { tenantId: T } });
  await owner.membershipPlan.deleteMany({ where: { tenantId: T } });
  await owner.auditLog.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Inscription en ligne", () => {
  it("crée un adhérent, un abonnement en attente et une transaction PENDING — sans rien activer", async () => {
    const { paymentId, checkoutUrl } = await signup();
    expect(checkoutUrl).toMatch(/^\/paiement-test\/SBX-/);
    const p = await paymentOf(paymentId!);
    expect(p.status).toBe("PENDING");
    expect(p.subscription?.status).toBe("PENDING_PAYMENT");
    expect(p.receipt).toBeNull();
  });

  it("la page publique ne résout que les salles actives", async () => {
    expect(await resolvePublicTenant(slug)).toBe(T);
    expect(await resolvePublicTenant("n-existe-pas")).toBeNull();
  });
});

describe("Notifications du prestataire", () => {
  it("succès : paiement confirmé, reçu émis, abonnement activé", async () => {
    const { paymentId } = await signup();
    const ref = (await paymentOf(paymentId!)).providerRef!;
    expect((await notify(ref, "SUCCEEDED", 20_000)).outcome).toBe("confirmed");
    const p = await paymentOf(paymentId!);
    expect(p.status).toBe("SUCCEEDED");
    expect(p.receipt?.number).toMatch(/^REC-/);
    expect(p.subscription?.status).toBe("ACTIVE");
  });

  it("idempotence : notification rejouée, ou seconde notification → un seul reçu", async () => {
    const { paymentId } = await signup();
    const ref = (await paymentOf(paymentId!)).providerRef!;
    const eventId = randomUUID();
    expect((await notify(ref, "SUCCEEDED", 20_000, eventId)).outcome).toBe("confirmed");
    expect((await notify(ref, "SUCCEEDED", 20_000, eventId)).outcome).toBe("duplicate");
    expect((await notify(ref, "SUCCEEDED", 20_000)).outcome).toBe("already");
    expect(await owner.receipt.count({ where: { paymentId: paymentId! } })).toBe(1);
  });

  it("échec : aucun abonnement payé n'est créé", async () => {
    const { paymentId } = await signup();
    const ref = (await paymentOf(paymentId!)).providerRef!;
    expect((await notify(ref, "FAILED", 20_000)).outcome).toBe("failed");
    const p = await paymentOf(paymentId!);
    expect(p.status).toBe("FAILED");
    expect(p.subscription?.status).toBe("PENDING_PAYMENT");
    expect(p.receipt).toBeNull();
  });

  it("montant différent de celui attendu : refusé, rien n'est activé", async () => {
    const { paymentId } = await signup();
    const ref = (await paymentOf(paymentId!)).providerRef!;
    expect((await notify(ref, "SUCCEEDED", 100)).outcome).toBe("amount_mismatch");
    expect((await paymentOf(paymentId!)).subscription?.status).toBe("PENDING_PAYMENT");
  });

  it("signature invalide : rejetée avant tout traitement", async () => {
    const body = JSON.stringify({ eventId: randomUUID(), providerRef: "SBX-x", status: "SUCCEEDED", amountXof: 1 });
    await expect(processWebhook("sandbox", body, new Headers({ "x-zahfit-signature": "faux" }))).rejects.toBeInstanceOf(
      InvalidWebhookError,
    );
  });
});

describe("Rapprochement et nouvel essai", () => {
  it("une tentative abandonnée expire", async () => {
    const { paymentId } = await signup();
    await owner.payment.update({
      where: { id: paymentId! },
      data: { createdAt: new Date(Date.now() - 3600_000), expiresAt: new Date(Date.now() - 60_000) },
    });
    const summary = await reconcilePendingPayments();
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect((await paymentOf(paymentId!)).status).toBe("EXPIRED");
  });

  it("un nouvel essai avec le même numéro réutilise l'abonnement en attente", async () => {
    const first = await signup();
    seq--; // même téléphone
    const second = await signup();
    expect(second.subscriptionId).toBe(first.subscriptionId);
  });
});
