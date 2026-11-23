import * as z from "zod";
import { audit } from "@/lib/audit";
import { withDbContext, type Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import type { TenantRole } from "@/lib/generated/prisma/enums";
import { localParts, zonedToUtc } from "@/lib/timezone";
import { cancelSessionBookings, promoteWaitlist } from "@/modules/bookings/bookings.service";
import { lockRow } from "@/modules/payments/payments.service";
import { checkbox, optionalText, requiredText } from "@/lib/validation";
import {
  DAY_KEYS,
  DAY_NAMES,
  HORIZON_DAYS,
  addDaysIso,
  fitsInDay,
  isAvailable,
  isTime,
  occurrenceDates,
  parseRanges,
  readAvailability,
  weekdayOf,
  type Availability,
} from "@/modules/classes/schedule";

/**
 * Cours collectifs et planning. Contexte RLS de la salle (withTenant) :
 * un coach, une salle ou un type d'une autre salle est invisible (et le
 * déclencheur `app.check_class_tenant` le refuse de toute façon).
 */

type Actor = { tenantId: string; userId: string | null };

/** Rôles autorisés à animer un cours. */
export const COACHING_ROLES: TenantRole[] = ["COACH", "MANAGER", "ADMIN"];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MINUTE = 60_000;

async function tenantTimezone(tx: Tx, tenantId: string) {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
}

/** « Aujourd'hui » et fuseau de la salle. */
export async function tenantToday(tx: Tx, tenantId: string, now = new Date()) {
  const timezone = await tenantTimezone(tx, tenantId);
  return { today: localParts(now, timezone).date, timezone };
}

// --- Validation ----------------------------------------------------------------

const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${label} invalide.` })
    .int(`${label} invalide.`)
    .min(min, `${label} : ${min} minimum.`)
    .max(max, `${label} : ${max} maximum.`);

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());

const timeField = z.string({ error: "Heure obligatoire." }).refine(isTime, "Heure invalide (HH:MM).");
const dateField = z.iso.date({ error: "Date invalide." });

export const roomSchema = z.object({
  name: requiredText("Le nom de la salle de cours", 60),
  capacity: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? Number(v) : null))
    .refine((n) => n === null || (Number.isInteger(n) && n >= 1 && n <= 1000), "Capacité invalide."),
  isActive: checkbox,
});

export const classTypeSchema = z.object({
  name: requiredText("Le nom du cours", 60),
  description: optionalText(300),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur invalide."),
  durationMinutes: intField("Durée", 10, 480),
  defaultCapacity: intField("Capacité", 1, 500),
  isActive: checkbox,
});

const slotFields = {
  coachId: z.uuid({ error: "Choisissez un coach." }),
  roomId: optionalUuid,
  startTime: timeField,
  durationMinutes: intField("Durée", 10, 480),
  capacity: intField("Capacité", 1, 500),
};

export const seriesSchema = z
  .object({
    classTypeId: z.uuid({ error: "Choisissez un type de cours." }),
    ...slotFields,
    weekday: intField("Jour", 1, 7),
    startsOn: dateField,
    endsOn: z
      .string()
      .optional()
      .transform((v) => v || null)
      .pipe(dateField.nullable()),
  })
  .refine((s) => !s.endsOn || s.endsOn >= s.startsOn, { path: ["endsOn"], message: "La fin doit suivre le début." });

export const oneOffSchema = z.object({
  classTypeId: z.uuid({ error: "Choisissez un type de cours." }),
  ...slotFields,
  date: dateField,
  notes: optionalText(300),
});

export const sessionUpdateSchema = z.object({ ...slotFields, date: dateField, notes: optionalText(300) });

export type SeriesInput = z.infer<typeof seriesSchema>;
export type OneOffInput = z.infer<typeof oneOffSchema>;
export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>;

/** Profil employé : disponibilités saisies jour par jour (« 06:00-12:00, 16:00-20:00 »). */
export function parseStaffProfile(formData: FormData) {
  const errors: Record<string, string[]> = {};
  const availability = Object.fromEntries(DAY_KEYS.map((d) => [d, [] as string[]])) as unknown as Availability;
  let declared = false;
  for (const day of DAY_KEYS) {
    const { ranges, error } = parseRanges(String(formData.get(`dispo_${day}`) ?? ""));
    if (error) errors[`dispo_${day}`] = [error];
    availability[day] = ranges;
    if (ranges.length) declared = true;
  }
  const specialties = String(formData.get("specialties") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (specialties.length > 10 || specialties.some((s) => s.length > 40)) {
    errors.specialties = ["10 spécialités de 40 caractères maximum."];
  }
  const bio = String(formData.get("bio") ?? "").trim();
  if (bio.length > 500) errors.bio = ["500 caractères maximum."];
  const phone = String(formData.get("phone") ?? "").trim();
  if (phone.length > 30) errors.phone = ["Numéro trop long."];
  return {
    errors,
    data: { phone: phone || null, bio: bio || null, specialties, availability: declared ? availability : null },
  };
}

// --- Salles de cours et types ------------------------------------------------

export const listRooms = (tx: Tx) => tx.room.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
export const listClassTypes = (tx: Tx) => tx.classType.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });

async function assertUniqueName(
  find: () => Promise<{ id: string } | null>,
  exceptId: string | undefined,
  message: string,
) {
  const existing = await find();
  if (existing && existing.id !== exceptId) throw new BusinessError(message, "name");
}

export async function saveRoom(tx: Tx, actor: Actor, input: z.infer<typeof roomSchema>, roomId?: string) {
  await assertUniqueName(
    () =>
      tx.room.findUnique({ where: { tenantId_name: { tenantId: actor.tenantId, name: input.name } }, select: { id: true } }),
    roomId,
    "Une salle de cours porte déjà ce nom.",
  );
  const room = roomId
    ? await tx.room.update({ where: { id: roomId }, data: input })
    : await tx.room.create({ data: { ...input, tenantId: actor.tenantId, isActive: true } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: roomId ? "room.update" : "room.create",
    entityType: "room",
    entityId: room.id,
    after: { name: room.name, capacity: room.capacity, isActive: room.isActive },
  });
  return room;
}

export async function saveClassType(tx: Tx, actor: Actor, input: z.infer<typeof classTypeSchema>, typeId?: string) {
  await assertUniqueName(
    () =>
      tx.classType.findUnique({
        where: { tenantId_name: { tenantId: actor.tenantId, name: input.name } },
        select: { id: true },
      }),
    typeId,
    "Un type de cours porte déjà ce nom.",
  );
  const type = typeId
    ? await tx.classType.update({ where: { id: typeId }, data: input })
    : await tx.classType.create({ data: { ...input, tenantId: actor.tenantId, isActive: true } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: typeId ? "class_type.update" : "class_type.create",
    entityType: "class_type",
    entityId: type.id,
    after: { name: type.name, durationMinutes: type.durationMinutes },
  });
  return type;
}

// --- Coachs et profils employés ------------------------------------------------

export function listCoaches(tx: Tx) {
  return tx.tenantMembership.findMany({
    where: { status: "ACTIVE", role: { in: COACHING_ROLES } },
    select: { id: true, role: true, specialties: true, availability: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

/** Listes des formulaires (objets simples, transmissibles aux composants client). */
export async function classOptions(tx: Tx) {
  // Séquentiel : une transaction PostgreSQL n'exécute qu'une requête à la fois.
  const types = await listClassTypes(tx);
  const coaches = await listCoaches(tx);
  const rooms = await listRooms(tx);
  return {
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      durationMinutes: t.durationMinutes,
      defaultCapacity: t.defaultCapacity,
      isActive: t.isActive,
    })),
    coaches: coaches.map((c) => ({ id: c.id, name: c.user.name, specialties: c.specialties })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, isActive: r.isActive })),
  };
}

export function getStaffMember(tx: Tx, membershipId: string) {
  return tx.tenantMembership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      phone: true,
      bio: true,
      specialties: true,
      availability: true,
      user: { select: { name: true, email: true } },
    },
  });
}

export async function updateStaffProfile(
  tx: Tx,
  actor: Actor,
  membershipId: string,
  data: ReturnType<typeof parseStaffProfile>["data"],
) {
  const member = await tx.tenantMembership.findUnique({ where: { id: membershipId }, select: { id: true } });
  if (!member) throw new BusinessError("Membre de l'équipe introuvable.");
  await tx.tenantMembership.update({
    where: { id: membershipId },
    data: { ...data, availability: data.availability ?? Prisma.DbNull },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "staff.profile.update",
    entityType: "membership",
    entityId: membershipId,
    after: { specialties: data.specialties, availabilityDeclared: data.availability !== null },
  });
}

// --- Contrôles communs ---------------------------------------------------------

type Slot = { coachId: string; roomId: string | null; startsAt: Date; endsAt: Date };

/** Coach, salle et type valides pour ce créneau (salle actuelle, actifs, disponibles). */
async function checkSlotRefs(
  tx: Tx,
  input: { coachId: string; roomId: string | null; capacity: number; classTypeId?: string },
  slot: { weekday: number; startTime: string; durationMinutes: number },
) {
  if (!fitsInDay(slot.startTime, slot.durationMinutes)) {
    throw new BusinessError("La séance doit se terminer avant minuit.", "durationMinutes");
  }
  const coach = await tx.tenantMembership.findUnique({
    where: { id: input.coachId },
    select: { status: true, role: true, availability: true, user: { select: { name: true } } },
  });
  if (!coach || coach.status !== "ACTIVE" || !COACHING_ROLES.includes(coach.role)) {
    throw new BusinessError("Ce coach n'est pas disponible dans la salle.", "coachId");
  }
  if (!isAvailable(readAvailability(coach.availability), slot.weekday, slot.startTime, slot.durationMinutes)) {
    throw new BusinessError(
      `${coach.user.name} n'est pas disponible le ${DAY_NAMES[slot.weekday].toLowerCase()} à ${slot.startTime} (voir ses disponibilités).`,
      "coachId",
    );
  }
  if (input.roomId) {
    const room = await tx.room.findUnique({
      where: { id: input.roomId },
      select: { isActive: true, capacity: true, name: true },
    });
    if (!room || !room.isActive) throw new BusinessError("Cette salle de cours n'est plus disponible.", "roomId");
    if (room.capacity !== null && input.capacity > room.capacity) {
      throw new BusinessError(`« ${room.name} » accueille ${room.capacity} personnes au maximum.`, "capacity");
    }
  }
  if (input.classTypeId) {
    const type = await tx.classType.findUnique({ where: { id: input.classTypeId }, select: { isActive: true } });
    if (!type || !type.isActive) throw new BusinessError("Ce type de cours n'est plus proposé.", "classTypeId");
  }
}

const overlaps = (a: Slot, b: Slot) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Premier chevauchement avec une séance programmée du même coach ou de la
 * même salle de cours. La contrainte d'exclusion en base reste le dernier
 * rempart (écritures simultanées) ; ce contrôle donne un message clair.
 */
async function assertNoConflict(tx: Tx, slots: Slot[], ignoreIds: string[] = []) {
  if (slots.length === 0) return;
  const from = new Date(Math.min(...slots.map((s) => s.startsAt.getTime())));
  const to = new Date(Math.max(...slots.map((s) => s.endsAt.getTime())));
  const coachIds = [...new Set(slots.map((s) => s.coachId))];
  const roomIds = [...new Set(slots.map((s) => s.roomId).filter((r): r is string => !!r))];
  const existing = await tx.classSession.findMany({
    where: {
      status: "SCHEDULED",
      id: { notIn: ignoreIds },
      startsAt: { lt: to },
      endsAt: { gt: from },
      OR: [{ coachId: { in: coachIds } }, ...(roomIds.length ? [{ roomId: { in: roomIds } }] : [])],
    },
    select: {
      coachId: true,
      roomId: true,
      startsAt: true,
      endsAt: true,
      classType: { select: { name: true } },
      coach: { select: { user: { select: { name: true } } } },
      room: { select: { name: true } },
    },
  });
  for (const slot of slots) {
    const clash = existing.find(
      (e) => overlaps(slot, e) && (e.coachId === slot.coachId || (slot.roomId !== null && e.roomId === slot.roomId)),
    );
    if (clash) {
      const who = clash.coachId === slot.coachId ? clash.coach.user.name : `la salle « ${clash.room?.name} »`;
      throw new BusinessError(
        `Conflit le ${formatDateTime(clash.startsAt)} : ${who} a déjà le cours « ${clash.classType.name} ».`,
        "startTime",
      );
    }
  }
}

/** Erreur d'exclusion PostgreSQL (chevauchement simultané) → message métier. */
function asOverlapError(error: unknown): never {
  const text = String((error as { message?: string })?.message ?? "");
  if (text.includes("class_sessions_coach_overlap") || text.includes("class_sessions_room_overlap")) {
    throw new BusinessError("Ce créneau vient d'être pris (coach ou salle déjà occupés). Rechargez le planning.");
  }
  throw error;
}

// --- Cours réguliers -------------------------------------------------------------

type SeriesRow = {
  id: string;
  classTypeId: string;
  coachId: string;
  roomId: string | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  capacity: number;
  startsOn: Date;
  endsOn: Date | null;
};

function sessionsFor(series: SeriesRow, dates: string[], tenantId: string, timezone: string) {
  return dates.map((date) => {
    const startsAt = zonedToUtc(date, series.startTime, timezone);
    return {
      tenantId,
      seriesId: series.id,
      occurrenceDate: dateOnly(date),
      classTypeId: series.classTypeId,
      coachId: series.coachId,
      roomId: series.roomId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + series.durationMinutes * MINUTE),
      capacity: series.capacity,
    };
  });
}

/**
 * Séances à créer pour une série entre deux dates : ni celles déjà en base
 * (exceptions comprises, identifiées par leur jour d'occurrence), ni celles
 * dont l'heure est déjà passée.
 */
async function missingSessions(
  tx: Tx,
  series: SeriesRow,
  tenantId: string,
  from: string,
  to: string,
  timezone: string,
  now: Date,
) {
  const dates = occurrenceDates(
    { weekday: series.weekday, startsOn: isoDay(series.startsOn), endsOn: series.endsOn ? isoDay(series.endsOn) : null },
    from,
    to,
  );
  if (dates.length === 0) return [];
  const existing = await tx.classSession.findMany({
    where: { seriesId: series.id, occurrenceDate: { in: dates.map(dateOnly) } },
    select: { occurrenceDate: true },
  });
  const taken = new Set(existing.map((e) => isoDay(e.occurrenceDate!)));
  return sessionsFor(
    series,
    dates.filter((d) => !taken.has(d)),
    tenantId,
    timezone,
  ).filter((row) => row.startsAt >= now);
}

/** Génère les séances d'une série (refus global si un créneau est en conflit). */
async function generate(tx: Tx, series: SeriesRow, tenantId: string, from: string, to: string, timezone: string, now: Date) {
  const rows = await missingSessions(tx, series, tenantId, from, to, timezone, now);
  await assertNoConflict(tx, rows);
  try {
    await tx.classSession.createMany({ data: rows, skipDuplicates: true });
  } catch (error) {
    asOverlapError(error);
  }
  await tx.classSeries.update({ where: { id: series.id }, data: { generatedUntil: dateOnly(to) } });
  return rows.length;
}

const seriesData = (input: SeriesInput) => ({
  classTypeId: input.classTypeId,
  coachId: input.coachId,
  roomId: input.roomId,
  weekday: input.weekday,
  startTime: input.startTime,
  durationMinutes: input.durationMinutes,
  capacity: input.capacity,
  startsOn: dateOnly(input.startsOn),
  endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
});

export async function createSeries(tx: Tx, actor: Actor, input: SeriesInput, today: string, now = new Date()) {
  await checkSlotRefs(tx, input, input);
  const timezone = await tenantTimezone(tx, actor.tenantId);
  const series = await tx.classSeries.create({
    data: { ...seriesData(input), tenantId: actor.tenantId, createdById: actor.userId },
  });
  const from = input.startsOn > today ? input.startsOn : today;
  const count = await generate(tx, series, actor.tenantId, from, addDaysIso(today, HORIZON_DAYS), timezone, now);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_series.create",
    entityType: "class_series",
    entityId: series.id,
    after: { weekday: series.weekday, startTime: series.startTime, sessions: count },
  });
  return { series, count };
}

/**
 * Modifier un cours régulier change les séances À VENIR qui n'ont pas été
 * modifiées une par une (exceptions conservées) ; le passé reste intact.
 */
export async function updateSeries(
  tx: Tx,
  actor: Actor,
  seriesId: string,
  input: SeriesInput,
  today: string,
  now = new Date(),
) {
  const before = await tx.classSeries.findUnique({ where: { id: seriesId } });
  if (!before) throw new BusinessError("Cours régulier introuvable.");
  await checkSlotRefs(tx, input, input);
  const timezone = await tenantTimezone(tx, actor.tenantId);
  // Une séance déjà réservée n'est jamais déplacée à l'insu des inscrits :
  // elle est conservée telle quelle (devenue exception) au lieu d'être recréée.
  const { count: removed } = await tx.classSession.deleteMany({
    where: { seriesId, isException: false, startsAt: { gte: now }, bookings: { none: {} } },
  });
  await tx.classSession.updateMany({
    where: { seriesId, isException: false, startsAt: { gte: now } },
    data: { isException: true },
  });
  const series = await tx.classSeries.update({ where: { id: seriesId }, data: seriesData(input) });
  const from = input.startsOn > today ? input.startsOn : today;
  const count = await generate(tx, series, actor.tenantId, from, addDaysIso(today, HORIZON_DAYS), timezone, now);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_series.update",
    entityType: "class_series",
    entityId: seriesId,
    before: { weekday: before.weekday, startTime: before.startTime, coachId: before.coachId },
    after: { weekday: series.weekday, startTime: series.startTime, coachId: series.coachId, removed, created: count },
  });
  return { series, count };
}

/**
 * Arrête un cours régulier après `lastDay` : les séances générées au-delà
 * disparaissent, les séances modifiées individuellement sont annulées
 * (motif conservé) pour rester visibles dans l'historique.
 */
export async function stopSeries(tx: Tx, actor: Actor, seriesId: string, lastDay: string) {
  const series = await tx.classSeries.findUnique({ where: { id: seriesId } });
  if (!series) throw new BusinessError("Cours régulier introuvable.");
  if (lastDay < isoDay(series.startsOn)) {
    throw new BusinessError("La date d'arrêt précède le début du cours.", "lastDay");
  }
  const timezone = await tenantTimezone(tx, actor.tenantId);
  const after = zonedToUtc(addDaysIso(lastDay, 1), "00:00", timezone);
  const { count: removed } = await tx.classSession.deleteMany({
    where: { seriesId, isException: false, startsAt: { gte: after }, bookings: { none: {} } },
  });
  // Séances modifiées une par une, ou déjà réservées : annulées (inscrits prévenus).
  const remaining = await tx.classSession.findMany({
    where: { seriesId, status: "SCHEDULED", startsAt: { gte: after } },
    select: { id: true },
  });
  const reason = "Cours régulier arrêté";
  for (const s of remaining) {
    await tx.classSession.update({ where: { id: s.id }, data: { status: "CANCELLED", cancelReason: reason } });
    await cancelSessionBookings(tx, actor.tenantId, s.id, reason);
  }
  const cancelled = remaining.length;
  await tx.classSeries.update({ where: { id: seriesId }, data: { endsOn: dateOnly(lastDay) } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_series.stop",
    entityType: "class_series",
    entityId: seriesId,
    after: { lastDay, removed, cancelled },
  });
  return { removed, cancelled };
}

/**
 * Prolonge l'horizon des séances (tâche planifiée quotidienne). Une
 * occurrence en conflit (ex. séance ponctuelle posée entre-temps) est
 * sautée et comptée, sans bloquer les autres.
 */
export async function extendHorizon(tx: Tx, tenantId: string, today: string, now = new Date()) {
  const timezone = await tenantTimezone(tx, tenantId);
  const until = addDaysIso(today, HORIZON_DAYS);
  const series = await tx.classSeries.findMany({
    where: {
      AND: [
        { OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(today) } }] },
        { OR: [{ generatedUntil: null }, { generatedUntil: { lt: dateOnly(until) } }] },
      ],
    },
  });
  let created = 0;
  let skipped = 0;
  for (const s of series) {
    for (const row of await missingSessions(tx, s, tenantId, today, until, timezone, now)) {
      try {
        await assertNoConflict(tx, [row]);
        created += (await tx.classSession.createMany({ data: [row], skipDuplicates: true })).count;
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        skipped++;
      }
    }
    await tx.classSeries.update({ where: { id: s.id }, data: { generatedUntil: dateOnly(until) } });
  }
  return { series: series.length, created, skipped };
}

/**
 * Tâche planifiée : prolonge l'horizon de TOUTES les salles actives, chacune
 * dans son propre contexte RLS (jamais de requête « toutes salles » en écriture).
 */
export async function extendAllHorizons(now = new Date()) {
  const tenants = await withDbContext({ platform: true }, (tx) =>
    tx.tenant.findMany({
      where: { status: "ACTIVE", deletedAt: null, classSeries: { some: {} } },
      select: { id: true },
    }),
  );
  const summary = { tenants: tenants.length, created: 0, skipped: 0 };
  for (const t of tenants) {
    const result = await withDbContext({ tenantId: t.id }, async (tx) => {
      const { today } = await tenantToday(tx, t.id, now);
      return extendHorizon(tx, t.id, today, now);
    });
    summary.created += result.created;
    summary.skipped += result.skipped;
  }
  return summary;
}

export function listSeries(tx: Tx) {
  return tx.classSeries.findMany({
    orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    include: {
      classType: { select: { name: true, color: true } },
      coach: { select: { user: { select: { name: true } } } },
      room: { select: { name: true } },
    },
  });
}

export const getSeries = (tx: Tx, seriesId: string) => tx.classSeries.findUnique({ where: { id: seriesId } });

// --- Séances ------------------------------------------------------------------

const sessionInclude = {
  classType: { select: { name: true, color: true } },
  coach: { select: { id: true, user: { select: { name: true } } } },
  room: { select: { name: true } },
  series: { select: { id: true, weekday: true, startTime: true } },
} satisfies Prisma.ClassSessionInclude;

export function listSessions(tx: Tx, from: Date, to: Date, options: { coachId?: string; scheduledOnly?: boolean } = {}) {
  return tx.classSession.findMany({
    where: {
      startsAt: { gte: from, lt: to },
      ...(options.coachId ? { coachId: options.coachId } : {}),
      ...(options.scheduledOnly ? { status: "SCHEDULED" as const } : {}),
    },
    orderBy: { startsAt: "asc" },
    include: sessionInclude,
  });
}

export type PlanningSession = Awaited<ReturnType<typeof listSessions>>[number];

export const getSession = (tx: Tx, sessionId: string) =>
  tx.classSession.findUnique({ where: { id: sessionId }, include: sessionInclude });

async function slotFor(tx: Tx, tenantId: string, input: SessionUpdateInput): Promise<Slot> {
  const timezone = await tenantTimezone(tx, tenantId);
  const startsAt = zonedToUtc(input.date, input.startTime, timezone);
  return {
    coachId: input.coachId,
    roomId: input.roomId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + input.durationMinutes * MINUTE),
  };
}

export async function createOneOffSession(tx: Tx, actor: Actor, input: OneOffInput) {
  await checkSlotRefs(tx, input, {
    weekday: weekdayOf(input.date),
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
  });
  const slot = await slotFor(tx, actor.tenantId, input);
  await assertNoConflict(tx, [slot]);
  const session = await tx.classSession
    .create({
      data: {
        ...slot,
        tenantId: actor.tenantId,
        classTypeId: input.classTypeId,
        capacity: input.capacity,
        notes: input.notes,
      },
    })
    .catch(asOverlapError);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_session.create",
    entityType: "class_session",
    entityId: session.id,
    after: { date: input.date, startTime: input.startTime },
  });
  return session;
}

/** Modifier UNE séance (remplacement de coach, décalage…) : elle devient une exception. */
export async function updateSession(tx: Tx, actor: Actor, sessionId: string, input: SessionUpdateInput) {
  await lockRow(tx, "class_sessions", sessionId);
  const before = await tx.classSession.findUnique({ where: { id: sessionId } });
  if (!before) throw new BusinessError("Séance introuvable.");
  if (before.status === "CANCELLED") throw new BusinessError("Rétablissez la séance avant de la modifier.");
  if (input.capacity < before.bookedCount) {
    throw new BusinessError(`${before.bookedCount} places sont déjà réservées : capacité minimum ${before.bookedCount}.`, "capacity");
  }
  await checkSlotRefs(tx, input, {
    weekday: weekdayOf(input.date),
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
  });
  const slot = await slotFor(tx, actor.tenantId, input);
  await assertNoConflict(tx, [slot], [sessionId]);
  const session = await tx.classSession
    .update({
      where: { id: sessionId },
      data: { ...slot, capacity: input.capacity, notes: input.notes, isException: before.seriesId !== null },
    })
    .catch(asOverlapError);
  // Places en plus : la liste d'attente en profite aussitôt.
  if (input.capacity > before.capacity) await promoteWaitlist(tx, actor.tenantId, sessionId);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_session.update",
    entityType: "class_session",
    entityId: sessionId,
    before: { startsAt: before.startsAt, coachId: before.coachId, roomId: before.roomId },
    after: { startsAt: session.startsAt, coachId: session.coachId, roomId: session.roomId },
  });
  return session;
}

export async function cancelSession(tx: Tx, actor: Actor, sessionId: string, reason: string) {
  const session = await tx.classSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new BusinessError("Séance introuvable.");
  if (session.status === "CANCELLED") throw new BusinessError("Cette séance est déjà annulée.");
  await tx.classSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED", cancelReason: reason, isException: session.seriesId !== null },
  });
  // Les réservations sont libérées et les inscrits prévenus (application + e-mail).
  const released = await cancelSessionBookings(tx, actor.tenantId, sessionId, reason);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_session.cancel",
    entityType: "class_session",
    entityId: sessionId,
    after: { reason, released },
  });
}

export async function restoreSession(tx: Tx, actor: Actor, sessionId: string) {
  const session = await tx.classSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new BusinessError("Séance introuvable.");
  if (session.status !== "CANCELLED") throw new BusinessError("Cette séance n'est pas annulée.");
  await assertNoConflict(tx, [session], [sessionId]);
  await tx.classSession
    .update({ where: { id: sessionId }, data: { status: "SCHEDULED", cancelReason: null } })
    .catch(asOverlapError);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "class_session.restore",
    entityType: "class_session",
    entityId: sessionId,
  });
}
