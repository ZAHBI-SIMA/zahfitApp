/**
 * Sprint 9 — WhatsApp, SMS de secours, consentements et renouvellement en un clic
 * contre PostgreSQL (RLS actif). Prestataires : simulateurs (aucun envoi réel).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import {
  InvalidSignatureError,
  applyDeliveryStatus,
  flushMessages,
  messagingUsage,
  processWhatsappWebhook,
  unsubscribeWithToken,
} from "@/modules/messaging/messaging.service";
import { signWhatsappPayload, unsubscribeToken } from "@/modules/messaging/providers";
import { createMember } from "@/modules/members/members.service";
import { notifyMember, runSubscriptionReminders } from "@/modules/notifications/notifications.service";
import { applyProviderStatus, startRenewal } from "@/modules/payments/online.service";
import { getProvider } from "@/modules/payments/providers";
import { createPlan } from "@/modules/plans/plans.service";
import { parseCalendarDate } from "@/modules/subscriptions/dates";
import { assignSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const d = (iso: string) => parseCalendarDate(iso)!;
const TODAY = "2027-03-08";
const NOW = new Date("2027-03-08T08:00:00Z");

const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `msg-a-${run}` };
const slug = `msg-${run}`;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
let planId = "";
let seq = 0;

async function member(consents: { whatsapp?: boolean; sms?: boolean }, phoneSuffix?: string) {
  seq++;
  return inA((tx) =>
    createMember(tx, A, {
      firstName: "Msg",
      lastName: `M${seq}`,
      phone: `+225014444${phoneSuffix ?? String(1000 + seq)}`,
      email: null,
      birthDate: null,
      consentWhatsapp: consents.whatsapp ?? false,
      consentSms: consents.sms ?? false,
      consentEmail: false,
    }),
  );
}

const cancelled = (memberId: string) =>
  inA((tx) =>
    notifyMember(tx, A.tenantId, memberId, "SESSION_CANCELLED", {
      className: "Yoga",
      when: "mardi 9 mars, 18:00",
      reason: "test",
    }),
  );
const messagesOf = (memberId: string) => owner.message.findMany({ where: { memberId }, orderBy: { createdAt: "asc" } });
const setChannels = (whatsappEnabled: boolean, smsEnabled: boolean) =>
  owner.tenant.update({ where: { id: A.tenantId }, data: { whatsappEnabled, smsEnabled } });

beforeAll(async () => {
  await owner.user.create({ data: { id: A.userId, name: "Admin", email: `${A.userId}@test.local` } });
  await owner.tenant.create({
    data: { id: A.tenantId, slug, name: "Salle Messages", whatsappEnabled: true, smsEnabled: true },
  });
  await owner.tenantMembership.create({ data: { tenantId: A.tenantId, userId: A.userId, role: "ADMIN" } });
  planId = (
    await inA((tx) =>
      createPlan(tx, A, {
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
      }),
    )
  ).id;
});

afterAll(async () => {
  const where = { tenantId: A.tenantId };
  await owner.message.deleteMany({ where: { ...where, fallbackOfId: { not: null } } });
  await owner.message.deleteMany({ where });
  await owner.renewalLink.deleteMany({ where });
  await owner.notification.deleteMany({ where });
  await owner.cashMovement.deleteMany({ where }); // mouvements de caisse des paiements en espèces
  await owner.receipt.deleteMany({ where });
  await owner.payment.deleteMany({ where });
  await owner.subscription.updateMany({ where, data: { previousId: null } });
  await owner.subscription.deleteMany({ where });
  await owner.member.deleteMany({ where });
  await owner.membershipPlan.deleteMany({ where });
  await owner.auditLog.deleteMany({ where });
  await owner.tenantMembership.deleteMany({ where });
  await owner.tenant.delete({ where: { id: A.tenantId } });
  await owner.user.delete({ where: { id: A.userId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Choix du canal et consentements", () => {
  it("WhatsApp si consenti, sinon SMS, sinon rien", async () => {
    const [wa, sms, none] = [await member({ whatsapp: true, sms: true }), await member({ sms: true }), await member({})];
    await cancelled(wa.id);
    await cancelled(sms.id);
    await cancelled(none.id);
    expect((await messagesOf(wa.id)).map((m) => m.channel)).toEqual(["WHATSAPP"]);
    expect((await messagesOf(sms.id)).map((m) => m.channel)).toEqual(["SMS"]);
    expect(await messagesOf(none.id)).toHaveLength(0);
    const smsMessage = (await messagesOf(sms.id))[0];
    expect(smsMessage.body).toMatch(/STOP : http.*\/desinscription\//);
    expect(smsMessage.toMasked).toMatch(/^\+225 •••• \d{4}$/);
  });

  it("un canal désactivé par la salle n'est jamais utilisé", async () => {
    await setChannels(false, false);
    const m = await member({ whatsapp: true, sms: true });
    await cancelled(m.id);
    expect(await messagesOf(m.id)).toHaveLength(0);
    await setChannels(true, true);
  });
});

describe("Envoi, statuts et repli SMS", () => {
  it("envoi par le worker : coût et identifiant du prestataire enregistrés", async () => {
    const m = await member({ whatsapp: true });
    await cancelled(m.id);
    await flushMessages(A.tenantId);
    const [sent] = await messagesOf(m.id);
    expect(sent).toMatchObject({ status: "SENT", provider: "whatsapp-sandbox", costXof: 25 });
    expect(sent.providerMessageId).toMatch(/^wa-sbx-/);

    await applyDeliveryStatus(sent.providerMessageId!, "delivered", null, NOW);
    expect(await applyDeliveryStatus(sent.providerMessageId!, "sent", null, NOW)).toBe("ignored"); // pas de retour en arrière
    const delivered = await owner.message.findUniqueOrThrow({ where: { id: sent.id } });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.toPhone).toBeNull(); // numéro effacé au statut final
  });

  it("WhatsApp en échec : SMS de secours si l'adhérent y a consenti", async () => {
    const m = await member({ whatsapp: true, sms: true });
    await cancelled(m.id);
    await flushMessages(A.tenantId);
    const [wa] = await messagesOf(m.id);
    await applyDeliveryStatus(wa.providerMessageId!, "failed", "Numéro non WhatsApp", NOW);
    await flushMessages(A.tenantId);
    const all = await messagesOf(m.id);
    expect(all.map((x) => [x.channel, x.status])).toEqual([
      ["WHATSAPP", "FAILED"],
      ["SMS", "SENT"],
    ]);
    expect(all[1].fallbackOfId).toBe(wa.id);
  });

  it("échec définitif sans consentement SMS : aucun repli", async () => {
    const m = await member({ whatsapp: true }, "0000"); // le simulateur refuse les numéros en 0000
    await cancelled(m.id);
    const summary = await flushMessages(A.tenantId);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect((await messagesOf(m.id)).map((x) => x.status)).toEqual(["FAILED"]);
  });
});

describe("Désinscription", () => {
  it("réponse STOP sur WhatsApp : consentement retiré et tracé", async () => {
    const m = await member({ whatsapp: true });
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: m.phone.slice(1), text: { body: "STOP" } }] } }] }],
    });
    await expect(processWhatsappWebhook(body, "sha256=faux")).rejects.toBeInstanceOf(InvalidSignatureError);
    const result = await processWhatsappWebhook(body, signWhatsappPayload(body));
    expect(result.optOuts).toBe(1);
    expect((await owner.member.findUniqueOrThrow({ where: { id: m.id } })).consentWhatsapp).toBe(false);
    expect(await owner.auditLog.count({ where: { entityId: m.id, action: "member.consent.optout" } })).toBe(1);
  });

  it("lien de désinscription signé : valide pour son adhérent, inutilisable s'il est modifié", async () => {
    const m = await member({ sms: true });
    const token = unsubscribeToken(A.tenantId, m.id, "SMS");
    expect((await unsubscribeWithToken(`${token}x`)).ok).toBe(false);
    expect((await unsubscribeWithToken(token)).ok).toBe(true);
    expect((await owner.member.findUniqueOrThrow({ where: { id: m.id } })).consentSms).toBe(false);
  });
});

describe("Renouvellement en un clic", () => {
  it("rappel J-7 avec lien ; paiement confirmé → renouvelé et lien consommé", async () => {
    const m = await member({ whatsapp: true });
    await inA(async (tx) => {
      const sub = await assignSubscription(tx, A, { memberId: m.id, planId, startDate: d("2027-03-02") }, d(TODAY));
      await recordManualPayment(tx, A, sub.id, { method: "CASH", providerRef: null });
      await tx.subscription.update({ where: { id: sub.id }, data: { endDate: d("2027-03-15") } }); // J-7
    });
    await inA((tx) => runSubscriptionReminders(tx, A.tenantId, TODAY, NOW));
    const [msg] = (await messagesOf(m.id)).filter((x) => x.template === "zahfit_rappel_echeance");
    const token = /\/renouveler\/([A-Za-z0-9_-]+)/.exec(msg.body)![1];

    const sandbox = getProvider("sandbox")!;
    const urls = (id: string) => ({ returnUrl: `http://test/${id}`, notifyUrl: "http://test/webhook" });
    const { paymentId, subscriptionId } = await startRenewal(A.tenantId, token, sandbox, urls, NOW);
    const renewal = await owner.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(renewal.startDate.toISOString().slice(0, 10)).toBe("2027-03-16"); // à la suite de l'actuel

    expect((await applyProviderStatus(A.tenantId, paymentId!, "SUCCEEDED", 20_000)).outcome).toBe("confirmed");
    expect((await owner.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status).toBe("ACTIVE");
    const link = await owner.renewalLink.findFirstOrThrow({ where: { memberId: m.id } });
    expect(link.usedAt).not.toBeNull();
    await expect(startRenewal(A.tenantId, token, sandbox, urls, NOW)).rejects.toThrow(/déjà payé/);
  });

  it("un jeton inconnu est refusé", async () => {
    const sandbox = getProvider("sandbox")!;
    await expect(
      startRenewal(A.tenantId, "x".repeat(43), sandbox, () => ({ returnUrl: "", notifyUrl: "" }), NOW),
    ).rejects.toThrow(/n'est pas valide/);
  });
});

describe("Coûts", () => {
  it("volumes et coût par canal sur la période", async () => {
    const usage = await inA((tx) =>
      messagingUsage(tx, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000)),
    );
    expect(usage.WHATSAPP.total).toBeGreaterThan(0);
    expect(usage.WHATSAPP.costXof).toBeGreaterThan(0);
    expect(usage.SMS.costXof).toBeGreaterThan(0);
  });
});
