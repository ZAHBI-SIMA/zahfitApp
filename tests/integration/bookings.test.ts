/**
 * Sprint 8 — réservations, liste d'attente, présences et notifications
 * contre PostgreSQL (RLS actif). « Maintenant » : lundi 8 mars 2027, 08:00 UTC.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import {
  attendanceStats,
  bookSession,
  cancelBooking,
  markAttendance,
} from "@/modules/bookings/bookings.service";
import {
  cancelSession,
  createOneOffSession,
  createSeries,
  saveClassType,
  stopSeries,
  updateSeries,
  updateSession,
  type SeriesInput,
} from "@/modules/classes/classes.service";
import { createMember } from "@/modules/members/members.service";
import { flushEmails, runSubscriptionReminders } from "@/modules/notifications/notifications.service";
import { createPlan } from "@/modules/plans/plans.service";
import { parseCalendarDate } from "@/modules/subscriptions/dates";
import { assignSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const d = (iso: string) => parseCalendarDate(iso)!;
const TODAY = "2027-03-08";
const NOW = new Date("2027-03-08T08:00:00Z");
const at = (iso: string) => new Date(iso);

const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `bk-a-${run}` };
const coachUser = `bk-coach-${run}`;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const ids = { coach: "", yoga: "", plan: "" };
let phoneSeq = 0;

/** Adhérent avec un mensuel payé du 1er au 31 mars 2027 (fin ajustable). */
async function member(options: { email?: boolean; subscribed?: boolean; endsOn?: string } = {}) {
  phoneSeq++;
  return inA(async (tx) => {
    const m = await createMember(tx, A, {
      firstName: "Bk",
      lastName: `M${phoneSeq}`,
      phone: `+22501555500${String(phoneSeq).padStart(2, "0")}`,
      email: options.email ? `bk${phoneSeq}-${run}@test.local` : null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    });
    if (options.subscribed !== false) {
      const sub = await assignSubscription(
        tx,
        A,
        { memberId: m.id, planId: ids.plan, startDate: d("2027-03-01") },
        d(TODAY),
      );
      await recordManualPayment(tx, A, sub.id, { method: "CASH", providerRef: null });
      if (options.endsOn) await tx.subscription.update({ where: { id: sub.id }, data: { endDate: d(options.endsOn) } });
    }
    return m;
  });
}

async function session(date: string, startTime: string, capacity: number) {
  return inA((tx) =>
    createOneOffSession(tx, A, {
      classTypeId: ids.yoga,
      coachId: ids.coach,
      roomId: null,
      date,
      startTime,
      durationMinutes: 60,
      capacity,
      notes: null,
    }),
  );
}

const book = (sessionId: string, memberId: string, byStaff = false, now = NOW) =>
  inA((tx) => bookSession(tx, A, { sessionId, memberId }, { byStaff, now }));
const bookingOf = (sessionId: string, memberId: string) =>
  owner.booking.findFirstOrThrow({ where: { sessionId, memberId }, orderBy: { createdAt: "desc" } });
const sessionRow = (id: string) => owner.classSession.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await owner.user.createMany({
    data: [A.userId, coachUser].map((id) => ({ id, name: `U ${id}`, email: `${id}@test.local` })),
  });
  await owner.tenant.create({ data: { id: A.tenantId, slug: `bk-${run}`, name: "Salle Résa" } });
  await owner.tenantMembership.create({ data: { tenantId: A.tenantId, userId: A.userId, role: "ADMIN" } });
  ids.coach = (
    await owner.tenantMembership.create({ data: { tenantId: A.tenantId, userId: coachUser, role: "COACH" } })
  ).id;
  ids.yoga = (
    await inA((tx) =>
      saveClassType(tx, A, {
        name: "Yoga",
        description: null,
        color: "#4F46E5",
        durationMinutes: 60,
        defaultCapacity: 2,
        isActive: true,
      }),
    )
  ).id;
  ids.plan = (
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
  await owner.booking.deleteMany({ where });
  await owner.classSession.deleteMany({ where });
  await owner.classSeries.deleteMany({ where });
  await owner.classType.deleteMany({ where });
  await owner.receipt.deleteMany({ where });
  await owner.payment.deleteMany({ where });
  await owner.subscription.updateMany({ where, data: { previousId: null } });
  await owner.subscription.deleteMany({ where });
  await owner.member.deleteMany({ where });
  await owner.membershipPlan.deleteMany({ where });
  await owner.auditLog.deleteMany({ where });
  await owner.tenantMembership.deleteMany({ where });
  await owner.tenant.delete({ where: { id: A.tenantId } });
  await owner.user.deleteMany({ where: { id: { in: [A.userId, coachUser] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Capacité et liste d'attente", () => {
  it("2 places : deux confirmés, le troisième en liste d'attente, promu quand une place se libère", async () => {
    const s = await session("2027-03-10", "18:00", 2);
    const [m1, m2, m3] = [await member(), await member(), await member({ email: true })];
    expect((await book(s.id, m1.id)).status).toBe("CONFIRMED");
    expect((await book(s.id, m2.id)).status).toBe("CONFIRMED");
    expect((await book(s.id, m3.id)).status).toBe("WAITLISTED");
    expect((await sessionRow(s.id)).bookedCount).toBe(2);
    await expect(book(s.id, m1.id)).rejects.toThrow(/Déjà inscrit/);

    const b1 = await bookingOf(s.id, m1.id);
    const { promoted } = await inA((tx) =>
      cancelBooking(tx, A, b1.id, { byStaff: false, now: NOW, memberId: m1.id }),
    );
    expect(promoted).toBe(1);
    expect(await bookingOf(s.id, m3.id)).toMatchObject({ status: "CONFIRMED" });
    const notif = await owner.notification.findFirstOrThrow({ where: { memberId: m3.id, type: "WAITLIST_PROMOTED" } });
    expect(notif.emailStatus).toBe("PENDING");
    expect((await sessionRow(s.id)).bookedCount).toBe(2);
  });

  it("la base refuse elle-même une place de trop (contrainte CHECK)", async () => {
    const s = await session("2027-03-10", "07:00", 1);
    const [m1, m2] = [await member(), await member()];
    await book(s.id, m1.id);
    await expect(
      owner.booking.create({ data: { tenantId: A.tenantId, sessionId: s.id, memberId: m2.id, status: "CONFIRMED" } }),
    ).rejects.toThrow(/class_sessions_booked_count/);
  });

  it("augmenter la capacité confirme la liste d'attente ; la baisser sous les réservations est refusé", async () => {
    const s = await session("2027-03-11", "18:00", 1);
    const [m1, m2] = [await member(), await member()];
    await book(s.id, m1.id);
    expect((await book(s.id, m2.id)).status).toBe("WAITLISTED");
    const slot = {
      coachId: ids.coach,
      roomId: null,
      date: "2027-03-11",
      startTime: "18:00",
      durationMinutes: 60,
      notes: null,
    };
    await inA((tx) => updateSession(tx, A, s.id, { ...slot, capacity: 2 }));
    expect((await bookingOf(s.id, m2.id)).status).toBe("CONFIRMED");
    await expect(inA((tx) => updateSession(tx, A, s.id, { ...slot, capacity: 1 }))).rejects.toThrow(
      /2 places sont déjà réservées/,
    );
  });
});

describe("Règles de réservation", () => {
  it("sans abonnement valable ce jour-là : refusé", async () => {
    const s = await session("2027-03-12", "18:00", 5);
    const m = await member({ subscribed: false });
    await expect(book(s.id, m.id)).rejects.toThrow(/Aucun abonnement en cours/);
  });

  it("ouverture 7 jours avant pour l'adhérent ; l'accueil peut réserver plus tôt", async () => {
    const s = await session("2027-03-20", "10:00", 5);
    const m = await member();
    await expect(book(s.id, m.id)).rejects.toThrow(/ouvrent 7 jours avant/);
    expect((await book(s.id, m.id, true)).status).toBe("CONFIRMED");
  });

  it("annulation libre jusqu'à 2 h avant ; ensuite, seulement par l'accueil", async () => {
    const s = await session("2027-03-09", "18:00", 5);
    const m = await member();
    const b = await book(s.id, m.id);
    const late = at("2027-03-09T17:00:00Z");
    await expect(
      inA((tx) => cancelBooking(tx, A, b.id, { byStaff: false, now: late, memberId: m.id })),
    ).rejects.toThrow(/moins de 2 h avant/);
    await inA((tx) => cancelBooking(tx, A, b.id, { byStaff: true, now: late, reason: "Malade" }));
    expect((await bookingOf(s.id, m.id)).status).toBe("CANCELLED");
  });

  it("un adhérent ne peut pas annuler la réservation d'un autre", async () => {
    const s = await session("2027-03-09", "07:00", 5);
    const [m1, m2] = [await member(), await member()];
    const b = await book(s.id, m1.id);
    await expect(
      inA((tx) => cancelBooking(tx, A, b.id, { byStaff: false, now: NOW, memberId: m2.id })),
    ).rejects.toThrow(/introuvable/);
  });
});

describe("Séance annulée et cours régulier", () => {
  it("annuler la séance libère les réservations et prévient les inscrits", async () => {
    const s = await session("2027-03-13", "09:00", 5);
    const [m1, m2] = [await member({ email: true }), await member()];
    await book(s.id, m1.id);
    await book(s.id, m2.id);
    await inA((tx) => cancelSession(tx, A, s.id, "Coach malade"));
    const bookings = await owner.booking.findMany({ where: { sessionId: s.id } });
    expect(bookings.every((b) => b.status === "CANCELLED")).toBe(true);
    expect((await sessionRow(s.id)).bookedCount).toBe(0);
    expect(await owner.notification.count({ where: { type: "SESSION_CANCELLED", memberId: m1.id } })).toBe(1);
  });

  it("modifier un cours régulier ne déplace pas une séance réservée ; l'arrêter l'annule", async () => {
    const input: SeriesInput = {
      classTypeId: ids.yoga,
      coachId: ids.coach,
      roomId: null,
      weekday: 1, // lundi
      startTime: "12:00",
      durationMinutes: 60,
      capacity: 5,
      startsOn: TODAY,
      endsOn: null,
    };
    const { series } = await inA((tx) => createSeries(tx, A, input, TODAY, NOW));
    const [, second] = await owner.classSession.findMany({
      where: { seriesId: series.id },
      orderBy: { startsAt: "asc" },
      take: 2,
    });
    const m = await member({ email: true });
    await book(second.id, m.id, true); // lundi 15 mars, 12:00 : au-delà de 7 jours, réservé par l'accueil

    await inA((tx) => updateSeries(tx, A, series.id, { ...input, startTime: "13:00" }, TODAY, NOW));
    const kept = await sessionRow(second.id);
    expect(kept.startsAt.toISOString()).toBe("2027-03-15T12:00:00.000Z");
    expect(kept.isException).toBe(true);

    await inA((tx) => stopSeries(tx, A, series.id, TODAY));
    expect((await sessionRow(second.id)).status).toBe("CANCELLED");
    expect((await bookingOf(second.id, m.id)).status).toBe("CANCELLED");
    expect(await owner.notification.count({ where: { memberId: m.id, type: "SESSION_CANCELLED" } })).toBe(1);
  });
});

describe("Présences", () => {
  it("pointage ouvert 30 min avant ; taux de remplissage et de présence", async () => {
    const s = await session("2027-03-14", "10:00", 5);
    const [m1, m2] = [await member(), await member()];
    const b1 = await book(s.id, m1.id);
    const b2 = await book(s.id, m2.id);
    await expect(inA((tx) => markAttendance(tx, A, b1.id, "PRESENT", NOW))).rejects.toThrow(/30 minutes avant/);
    const during = at("2027-03-14T10:05:00Z");
    await inA((tx) => markAttendance(tx, A, b1.id, "PRESENT", during));
    await inA((tx) => markAttendance(tx, A, b2.id, "ABSENT", during));
    const stats = await inA((tx) =>
      attendanceStats(tx, at("2027-03-14T00:00:00Z"), at("2027-03-15T00:00:00Z")),
    );
    expect(stats).toMatchObject({ sessions: 1, booked: 2, present: 1, attendanceRate: 50, fillRate: 40 });
  });
});

describe("Notifications", () => {
  it("rappels J-7 et J0, un seul envoi par étape", async () => {
    const expiring = await member({ email: true, endsOn: "2027-03-15" }); // J-7
    const expired = await member({ email: true, endsOn: "2027-03-07" }); // terminé hier : J0
    expect(await inA((tx) => runSubscriptionReminders(tx, A.tenantId, TODAY))).toBeGreaterThanOrEqual(2);
    expect(await owner.notification.count({ where: { memberId: expiring.id, type: "SUBSCRIPTION_EXPIRING" } })).toBe(1);
    expect(await owner.notification.count({ where: { memberId: expired.id, type: "SUBSCRIPTION_EXPIRED" } })).toBe(1);
    expect(await inA((tx) => runSubscriptionReminders(tx, A.tenantId, TODAY))).toBe(0);
  });

  it("la boîte d'envoi part après validation, puis l'adresse est effacée", async () => {
    const result = await flushEmails(A.tenantId, 100);
    expect(result.sent).toBeGreaterThan(0);
    const sent = await owner.notification.findMany({ where: { tenantId: A.tenantId, emailStatus: "SENT" } });
    expect(sent.length).toBe(result.sent);
    expect(sent.every((n) => n.emailTo === null && n.emailSentAt !== null)).toBe(true);
  });
});
