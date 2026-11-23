import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { localParts } from "@/lib/timezone";
import { notifyMember } from "@/modules/notifications/notifications.service";
import { lockRow } from "@/modules/payments/payments.service";

/**
 * Réservations de cours. La CAPACITÉ est garantie par la base (compteur
 * `booked_count` tenu par déclencheur + CHECK ≤ capacity) ; le verrou sur la
 * ligne de la séance sert à départager proprement les demandes simultanées
 * (ordre de la liste d'attente, promotion).
 */

type Actor = { tenantId: string; userId: string | null };
const HOUR = 3_600_000;
/** Le pointage s'ouvre 30 min avant la séance et reste possible 7 jours. */
const ATTENDANCE_OPENS_MS = 30 * 60_000;
const ATTENDANCE_CLOSES_MS = 7 * 24 * HOUR;

const whenLabel = (d: Date, timezone: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

async function loadSession(tx: Tx, sessionId: string) {
  const session = await tx.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      bookedCount: true,
      coachId: true,
      classType: { select: { name: true } },
      tenant: { select: { timezone: true, bookingOpenDays: true, bookingCancelHours: true } },
    },
  });
  if (!session) throw new BusinessError("Séance introuvable.");
  return session;
}

/**
 * Abonnement valable à la date et à l'heure de la séance (jours et créneau
 * de la formule compris) : réserver un cours n'a de sens que si l'on pourra entrer.
 */
async function assertEligible(tx: Tx, memberId: string, startsAt: Date, timezone: string) {
  const member = await tx.member.findUnique({ where: { id: memberId }, select: { status: true } });
  if (!member) throw new BusinessError("Adhérent introuvable.");
  if (member.status !== "ACTIVE") throw new BusinessError("Cet adhérent n'est pas actif.");
  const local = localParts(startsAt, timezone);
  const day = new Date(`${local.date}T00:00:00Z`);
  const subs = await tx.subscription.findMany({
    where: { memberId, status: "ACTIVE", startDate: { lte: day }, endDate: { gte: day } },
    select: { allowedDays: true, accessFrom: true, accessUntil: true },
  });
  const ok = subs.some(
    (s) =>
      (s.allowedDays.length === 0 || s.allowedDays.includes(local.weekday)) &&
      (!s.accessFrom || !s.accessUntil || (local.time >= s.accessFrom && local.time < s.accessUntil)),
  );
  if (!ok) {
    throw new BusinessError(
      subs.length
        ? "La formule de l'adhérent ne couvre pas ce jour ou cet horaire."
        : `Aucun abonnement en cours le ${formatDate(day)} : renouvelez à l'accueil pour réserver.`,
    );
  }
}

// --- Réserver ------------------------------------------------------------------

export async function bookSession(
  tx: Tx,
  actor: Actor,
  input: { sessionId: string; memberId: string },
  options: { byStaff: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  await lockRow(tx, "class_sessions", input.sessionId);
  const session = await loadSession(tx, input.sessionId);
  if (session.status === "CANCELLED") throw new BusinessError("Cette séance est annulée.");
  if (session.startsAt <= now) throw new BusinessError("Cette séance a déjà commencé.");
  const openDays = session.tenant.bookingOpenDays;
  if (!options.byStaff && session.startsAt.getTime() > now.getTime() + openDays * 24 * HOUR) {
    throw new BusinessError(`Les réservations ouvrent ${openDays} jours avant la séance.`);
  }
  await assertEligible(tx, input.memberId, session.startsAt, session.tenant.timezone);

  const existing = await tx.booking.findFirst({
    where: { sessionId: input.sessionId, memberId: input.memberId, status: { not: "CANCELLED" } },
    select: { status: true },
  });
  if (existing) {
    throw new BusinessError(
      existing.status === "CONFIRMED" ? "Déjà inscrit(e) à cette séance." : "Déjà sur la liste d'attente.",
    );
  }

  const status = session.bookedCount < session.capacity ? ("CONFIRMED" as const) : ("WAITLISTED" as const);
  const booking = await tx.booking
    .create({
      data: {
        tenantId: actor.tenantId,
        sessionId: input.sessionId,
        memberId: input.memberId,
        status,
        bookedById: actor.userId,
      },
    })
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BusinessError("Déjà inscrit(e) à cette séance.");
      }
      throw error;
    });

  const when = whenLabel(session.startsAt, session.tenant.timezone);
  if (status === "CONFIRMED") {
    // L'adhérent qui réserve lui-même voit la confirmation à l'écran : e-mail seulement si c'est l'accueil.
    await notifyMember(
      tx,
      actor.tenantId,
      input.memberId,
      "BOOKING_CONFIRMED",
      { className: session.classType.name, when },
      { email: options.byStaff },
    );
  } else {
    const position = await tx.booking.count({
      where: { sessionId: input.sessionId, status: "WAITLISTED", createdAt: { lte: booking.createdAt } },
    });
    await notifyMember(tx, actor.tenantId, input.memberId, "BOOKING_WAITLISTED", {
      className: session.classType.name,
      when,
      position,
    });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "booking.create",
    entityType: "booking",
    entityId: booking.id,
    after: { sessionId: input.sessionId, status, byStaff: options.byStaff },
  });
  return booking;
}

// --- Liste d'attente -------------------------------------------------------------

/**
 * Remplit les places libres avec la liste d'attente, dans l'ordre d'arrivée.
 * À appeler avec la séance verrouillée (annulation, hausse de capacité).
 */
export async function promoteWaitlist(tx: Tx, tenantId: string, sessionId: string, now: Date = new Date()) {
  const session = await loadSession(tx, sessionId);
  if (session.status === "CANCELLED" || session.startsAt <= now) return 0;
  const free = session.capacity - session.bookedCount;
  if (free <= 0) return 0;
  const next = await tx.booking.findMany({
    where: { sessionId, status: "WAITLISTED" },
    orderBy: { createdAt: "asc" },
    take: free,
    select: { id: true, memberId: true },
  });
  const when = whenLabel(session.startsAt, session.tenant.timezone);
  for (const b of next) {
    await tx.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED", promotedAt: now } });
    await notifyMember(tx, tenantId, b.memberId, "WAITLIST_PROMOTED", { className: session.classType.name, when });
  }
  return next.length;
}

// --- Annuler -------------------------------------------------------------------

/**
 * L'adhérent annule librement jusqu'à N heures avant (réglage de la salle) ;
 * au-delà, seul l'accueil peut annuler. Une place confirmée libérée est
 * aussitôt proposée au premier de la liste d'attente.
 */
export async function cancelBooking(
  tx: Tx,
  actor: Actor,
  bookingId: string,
  options: { byStaff: boolean; reason?: string | null; now?: Date; memberId?: string },
) {
  const now = options.now ?? new Date();
  const found = await tx.booking.findUnique({ where: { id: bookingId }, select: { sessionId: true } });
  if (!found) throw new BusinessError("Réservation introuvable.");
  await lockRow(tx, "class_sessions", found.sessionId);
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  // Un adhérent ne peut annuler que SES réservations.
  if (options.memberId && booking.memberId !== options.memberId) throw new BusinessError("Réservation introuvable.");
  if (booking.status === "CANCELLED") throw new BusinessError("Cette réservation est déjà annulée.");
  const session = await loadSession(tx, booking.sessionId);
  if (!options.byStaff && booking.status === "CONFIRMED") {
    const hours = session.tenant.bookingCancelHours;
    if (session.startsAt.getTime() - now.getTime() < hours * HOUR) {
      throw new BusinessError(`Annulation impossible moins de ${hours} h avant le cours : prévenez l'accueil.`);
    }
  }

  await tx.booking.update({
    where: { id: bookingId },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: options.reason ?? null },
  });
  const promoted =
    booking.status === "CONFIRMED" ? await promoteWaitlist(tx, actor.tenantId, booking.sessionId, now) : 0;
  if (options.byStaff) {
    await notifyMember(tx, actor.tenantId, booking.memberId, "BOOKING_CANCELLED", {
      className: session.classType.name,
      when: whenLabel(session.startsAt, session.tenant.timezone),
      reason: options.reason ?? undefined,
    });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "booking.cancel",
    entityType: "booking",
    entityId: bookingId,
    after: { byStaff: options.byStaff, promoted },
  });
  return { promoted };
}

/** Séance annulée : toutes ses réservations sont libérées et les adhérents prévenus. */
export async function cancelSessionBookings(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  reason: string,
  now: Date = new Date(),
) {
  const session = await loadSession(tx, sessionId);
  const active = await tx.booking.findMany({
    where: { sessionId, status: { not: "CANCELLED" } },
    select: { id: true, memberId: true },
  });
  const when = whenLabel(session.startsAt, session.tenant.timezone);
  for (const b of active) {
    await tx.booking.update({
      where: { id: b.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelReason: `Séance annulée : ${reason}` },
    });
    await notifyMember(tx, tenantId, b.memberId, "SESSION_CANCELLED", {
      className: session.classType.name,
      when,
      reason,
    });
  }
  return active.length;
}

// --- Présences -----------------------------------------------------------------

export async function markAttendance(
  tx: Tx,
  actor: Actor,
  bookingId: string,
  attendance: AttendanceStatus | null,
  now: Date = new Date(),
) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, session: { select: { startsAt: true, status: true } } },
  });
  if (!booking) throw new BusinessError("Réservation introuvable.");
  if (booking.status !== "CONFIRMED") throw new BusinessError("Seules les places confirmées se pointent.");
  if (booking.session.status === "CANCELLED") throw new BusinessError("Séance annulée.");
  const start = booking.session.startsAt.getTime();
  if (now.getTime() < start - ATTENDANCE_OPENS_MS) {
    throw new BusinessError("Le pointage s'ouvre 30 minutes avant la séance.");
  }
  if (now.getTime() > start + ATTENDANCE_CLOSES_MS) {
    throw new BusinessError("Le pointage est clos (7 jours après la séance).");
  }
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      attendance,
      attendanceMarkedAt: attendance ? now : null,
      attendanceMarkedById: attendance ? actor.userId : null,
    },
  });
}

// --- Lectures --------------------------------------------------------------------

/**
 * Participants d'une séance : nom et code seulement (le coach n'a pas accès
 * aux téléphones ni aux e-mails — minimisation des données).
 */
export function sessionParticipants(tx: Tx, sessionId: string) {
  return tx.booking.findMany({
    where: { sessionId, status: { not: "CANCELLED" } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      status: true,
      attendance: true,
      createdAt: true,
      promotedAt: true,
      member: { select: { id: true, code: true, firstName: true, lastName: true } },
    },
  });
}

export type Participant = Awaited<ReturnType<typeof sessionParticipants>>[number];

/** Séances ouvertes à la réservation pour un adhérent, avec sa réservation éventuelle. */
export async function bookableSessions(tx: Tx, memberId: string, now: Date = new Date()) {
  const { tenant } = await tx.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { tenant: { select: { bookingOpenDays: true, bookingCancelHours: true, timezone: true } } },
  });
  const until = new Date(now.getTime() + tenant.bookingOpenDays * 24 * HOUR);
  const sessions = await tx.classSession.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: now, lte: until } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      bookedCount: true,
      classType: { select: { name: true, color: true } },
      coach: { select: { user: { select: { name: true } } } },
      room: { select: { name: true } },
      bookings: { where: { memberId, status: { not: "CANCELLED" } }, select: { id: true, status: true } },
    },
  });
  return { sessions, settings: tenant };
}

/** Réservations à venir d'un adhérent. */
export function memberUpcomingBookings(tx: Tx, memberId: string, now: Date = new Date()) {
  return tx.booking.findMany({
    where: { memberId, status: { not: "CANCELLED" }, session: { startsAt: { gt: now } } },
    orderBy: { session: { startsAt: "asc" } },
    select: {
      id: true,
      status: true,
      session: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          classType: { select: { name: true, color: true } },
        },
      },
    },
  });
}

/**
 * Taux de remplissage (places confirmées / capacité) et de présence
 * (présents / pointés) des séances programmées sur une période.
 */
export async function attendanceStats(tx: Tx, from: Date, to: Date, options: { coachId?: string } = {}) {
  const sessions = await tx.classSession.findMany({
    where: {
      status: "SCHEDULED",
      startsAt: { gte: from, lt: to },
      ...(options.coachId ? { coachId: options.coachId } : {}),
    },
    select: {
      capacity: true,
      bookedCount: true,
      bookings: { where: { status: "CONFIRMED" }, select: { attendance: true } },
    },
  });
  const sum = (f: (s: (typeof sessions)[number]) => number) => sessions.reduce((n, s) => n + f(s), 0);
  const capacity = sum((s) => s.capacity);
  const booked = sum((s) => s.bookedCount);
  const present = sum((s) => s.bookings.filter((b) => b.attendance === "PRESENT").length);
  const marked = sum((s) => s.bookings.filter((b) => b.attendance !== null).length);
  return {
    sessions: sessions.length,
    booked,
    present,
    fillRate: capacity ? Math.round((booked / capacity) * 100) : null,
    attendanceRate: marked ? Math.round((present / marked) * 100) : null,
  };
}

// --- Réglages ------------------------------------------------------------------

export async function updateBookingSettings(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  input: { bookingOpenDays: number; bookingCancelHours: number },
) {
  await tx.tenant.update({ where: { id: actor.tenantId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.booking.update",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: input,
  });
}
