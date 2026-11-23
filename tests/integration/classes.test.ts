/**
 * Sprint 7 — cours réguliers, exceptions et conflits contre PostgreSQL (RLS actif).
 * « Aujourd'hui » est figé : lundi 8 mars 2027, 08:00 (Abidjan = UTC).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import {
  cancelSession,
  createOneOffSession,
  createSeries,
  extendHorizon,
  restoreSession,
  saveClassType,
  saveRoom,
  stopSeries,
  updateSeries,
  updateSession,
  updateStaffProfile,
  type SeriesInput,
} from "@/modules/classes/classes.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const TODAY = "2027-03-08";
const NOW = new Date("2027-03-08T08:00:00Z");

const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `cls-a-${run}` };
const B = { tenantId: randomUUID(), userId: `cls-b-${run}` };
const coachUsers = [`cls-coach1-${run}`, `cls-coach2-${run}`, `cls-coachb-${run}`];
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);

const ids = { coach1: "", coach2: "", coachB: "", room: "", smallRoom: "", yoga: "" };

const series = (extra: Partial<SeriesInput> = {}): SeriesInput => ({
  classTypeId: ids.yoga,
  coachId: ids.coach1,
  roomId: ids.room,
  weekday: 3, // mercredi
  startTime: "18:00",
  durationMinutes: 60,
  capacity: 20,
  startsOn: TODAY,
  endsOn: null,
  ...extra,
});

const sessionsOf = (seriesId: string) =>
  owner.classSession.findMany({ where: { seriesId }, orderBy: { startsAt: "asc" } });

beforeAll(async () => {
  await owner.user.createMany({
    data: [A.userId, B.userId, ...coachUsers].map((id) => ({ id, name: `Coach ${id}`, email: `${id}@test.local` })),
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `ca-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `cb-${run}`, name: "Salle B" },
    ],
  });
  const membership = (tenantId: string, userId: string, role: "ADMIN" | "COACH") =>
    owner.tenantMembership.create({ data: { tenantId, userId, role } });
  await membership(A.tenantId, A.userId, "ADMIN");
  ids.coach1 = (await membership(A.tenantId, coachUsers[0], "COACH")).id;
  ids.coach2 = (await membership(A.tenantId, coachUsers[1], "COACH")).id;
  ids.coachB = (await membership(B.tenantId, coachUsers[2], "COACH")).id;

  ids.room = (await inA((tx) => saveRoom(tx, A, { name: "Studio", capacity: 25, isActive: true }))).id;
  ids.smallRoom = (await inA((tx) => saveRoom(tx, A, { name: "Box", capacity: 6, isActive: true }))).id;
  ids.yoga = (
    await inA((tx) =>
      saveClassType(tx, A, {
        name: "Yoga",
        description: null,
        color: "#4F46E5",
        durationMinutes: 60,
        defaultCapacity: 20,
        isActive: true,
      }),
    )
  ).id;
});

afterAll(async () => {
  const tenants = { in: [A.tenantId, B.tenantId] };
  await owner.classSession.deleteMany({ where: { tenantId: tenants } });
  await owner.classSeries.deleteMany({ where: { tenantId: tenants } });
  await owner.classType.deleteMany({ where: { tenantId: tenants } });
  await owner.room.deleteMany({ where: { tenantId: tenants } });
  await owner.auditLog.deleteMany({ where: { tenantId: tenants } });
  await owner.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  await owner.tenant.deleteMany({ where: { id: tenants } });
  await owner.user.deleteMany({ where: { id: { in: [A.userId, B.userId, ...coachUsers] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Cours régulier", () => {
  let seriesId = "";

  it("génère les séances des 8 prochaines semaines à l'heure de la salle", async () => {
    const { series: s, count } = await inA((tx) => createSeries(tx, A, series(), TODAY, NOW));
    seriesId = s.id;
    expect(count).toBe(8); // mercredis du 10 mars au 28 avril
    const sessions = await sessionsOf(seriesId);
    expect(sessions[0].startsAt.toISOString()).toBe("2027-03-10T18:00:00.000Z");
    expect(sessions[0].endsAt.toISOString()).toBe("2027-03-10T19:00:00.000Z");
    expect(sessions.every((x) => x.capacity === 20 && x.roomId === ids.room)).toBe(true);
  });

  it("refuse un second cours du même coach qui chevauche", async () => {
    await expect(
      inA((tx) => createSeries(tx, A, series({ startTime: "18:30", roomId: ids.smallRoom, capacity: 5 }), TODAY, NOW)),
    ).rejects.toThrow(/Conflit .* Coach/);
  });

  it("refuse un autre coach dans la même salle au même moment", async () => {
    await expect(inA((tx) => createSeries(tx, A, series({ coachId: ids.coach2 }), TODAY, NOW))).rejects.toThrow(
      /Conflit .* salle « Studio »/,
    );
  });

  it("la base refuse elle aussi un chevauchement (écritures simultanées)", async () => {
    const [first] = await sessionsOf(seriesId);
    await expect(
      owner.classSession.create({
        data: {
          tenantId: A.tenantId,
          classTypeId: ids.yoga,
          coachId: ids.coach1,
          startsAt: new Date(first.startsAt.getTime() + 15 * 60_000),
          endsAt: first.endsAt,
          capacity: 5,
        },
      }),
    ).rejects.toThrow(/class_sessions_coach_overlap/);
  });

  it("une séance modifiée (exception) survit à la modification du cours régulier", async () => {
    const sessions = await sessionsOf(seriesId);
    const second = sessions[1]; // 17 mars
    await inA((tx) =>
      updateSession(tx, A, second.id, {
        coachId: ids.coach2,
        roomId: ids.room,
        date: "2027-03-17",
        startTime: "19:30",
        durationMinutes: 60,
        capacity: 15,
        notes: "Remplacement",
      }),
    );
    // Le cours régulier passe à 17:00 : les séances à venir bougent, sauf l'exception.
    await inA((tx) => updateSeries(tx, A, seriesId, series({ startTime: "17:00" }), TODAY, NOW));
    const after = await sessionsOf(seriesId);
    expect(after).toHaveLength(8);
    const exception = after.find((x) => x.id === second.id)!;
    expect(exception).toMatchObject({ isException: true, coachId: ids.coach2, capacity: 15 });
    expect(exception.startsAt.toISOString()).toBe("2027-03-17T19:30:00.000Z");
    const regular = after.filter((x) => !x.isException);
    expect(regular.every((x) => x.startsAt.toISOString().endsWith("T17:00:00.000Z"))).toBe(true);
  });

  it("annuler puis rétablir une séance", async () => {
    const [first] = await sessionsOf(seriesId);
    await inA((tx) => cancelSession(tx, A, first.id, "Coach malade"));
    expect(await owner.classSession.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: "CANCELLED",
      cancelReason: "Coach malade",
    });
    await inA((tx) => restoreSession(tx, A, first.id));
    expect((await owner.classSession.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SCHEDULED");
  });

  it("arrêter le cours : séances retirées après la date, exception annulée", async () => {
    const sessions = await sessionsOf(seriesId);
    const april7 = sessions.find((x) => x.occurrenceDate?.toISOString().startsWith("2027-04-07"))!;
    await inA((tx) =>
      updateSession(tx, A, april7.id, {
        coachId: ids.coach1,
        roomId: ids.room,
        date: "2027-04-07",
        startTime: "17:00",
        durationMinutes: 90,
        capacity: 20,
        notes: null,
      }),
    );
    const { removed, cancelled } = await inA((tx) => stopSeries(tx, A, seriesId, "2027-03-31"));
    expect(removed).toBe(3); // 14, 21 et 28 avril
    expect(cancelled).toBe(1); // l'exception du 7 avril reste visible, annulée
    const left = await sessionsOf(seriesId);
    expect(left.filter((x) => x.status === "SCHEDULED").every((x) => x.startsAt < new Date("2027-04-01"))).toBe(true);
  });

  it("le cron prolonge l'horizon sans doublon", async () => {
    const { series: s } = await inA((tx) =>
      createSeries(tx, A, series({ weekday: 5, startTime: "07:00", roomId: null }), TODAY, NOW),
    );
    const before = (await sessionsOf(s.id)).length;
    const later = new Date("2027-03-22T08:00:00Z");
    expect((await inA((tx) => extendHorizon(tx, A.tenantId, "2027-03-22", later))).created).toBe(2); // 7 et 14 mai
    expect((await inA((tx) => extendHorizon(tx, A.tenantId, "2027-03-22", later))).created).toBe(0);
    expect((await sessionsOf(s.id)).length).toBe(before + 2);
  });
});

describe("Règles métier", () => {
  it("le coach doit être disponible sur le créneau s'il a déclaré ses disponibilités", async () => {
    await inA((tx) =>
      updateStaffProfile(tx, A, ids.coach2, {
        phone: null,
        bio: null,
        specialties: ["Pilates"],
        availability: { lun: [], mar: ["06:00-12:00"], mer: [], jeu: [], ven: [], sam: [], dim: [] },
      }),
    );
    const tuesday = (startTime: string) => series({ coachId: ids.coach2, weekday: 2, startTime, roomId: null });
    await expect(inA((tx) => createSeries(tx, A, tuesday("18:00"), TODAY, NOW))).rejects.toThrow(
      /n'est pas disponible le mardi/,
    );
    expect((await inA((tx) => createSeries(tx, A, tuesday("08:00"), TODAY, NOW))).count).toBeGreaterThan(0);
  });

  it("la capacité ne dépasse pas celle de la salle de cours", async () => {
    await expect(
      inA((tx) =>
        createOneOffSession(tx, A, {
          classTypeId: ids.yoga,
          coachId: ids.coach1,
          roomId: ids.smallRoom,
          date: "2027-03-13",
          startTime: "10:00",
          durationMinutes: 60,
          capacity: 10,
          notes: null,
        }),
      ),
    ).rejects.toThrow(/6 personnes au maximum/);
  });

  it("un coach d'une autre salle est refusé (RLS et déclencheur)", async () => {
    await expect(
      inA((tx) => createSeries(tx, A, series({ coachId: ids.coachB, roomId: null }), TODAY, NOW)),
    ).rejects.toThrow(/coach n'est pas disponible/);
    await expect(
      owner.classSession.create({
        data: {
          tenantId: A.tenantId,
          classTypeId: ids.yoga,
          coachId: ids.coachB,
          startsAt: new Date("2027-06-01T10:00:00Z"),
          endsAt: new Date("2027-06-01T11:00:00Z"),
          capacity: 5,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" }); // déclencheur app.check_class_tenant (SQLSTATE 23503)
  });

  it("une salle ne voit pas le planning d'une autre", async () => {
    const seenByB = await withTenant(B.tenantId, B.userId, (tx) =>
      tx.classSession.count({ where: { tenantId: A.tenantId } }),
    );
    expect(seenByB).toBe(0);
  });
});
