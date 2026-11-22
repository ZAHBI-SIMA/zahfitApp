/**
 * Sprint 2 — adhérents et équipe, contre une vraie base PostgreSQL (RLS actif).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { analyzeMemberCsv, importMembers } from "@/modules/members/members.import";
import type { MemberInput } from "@/modules/members/members.schema";
import { createMember, getMember, searchMembers, setMemberArchived } from "@/modules/members/members.service";
import { changeStaffRole, setStaffStatus } from "@/modules/staff/staff.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `adm-a-${run}` };
const B = { tenantId: randomUUID(), userId: `adm-b-${run}` };
const coachId = `coach-a-${run}`;
let adminMembershipA = "";
let coachMembershipA = "";

const input = (phone: string, firstName = "Awa"): MemberInput => ({
  firstName,
  lastName: "Koné",
  phone,
  email: null,
  birthDate: null,
  consentWhatsapp: true,
  consentSms: false,
  consentEmail: false,
});

beforeAll(async () => {
  await owner.user.createMany({
    data: [
      { id: A.userId, name: "Admin A", email: `${A.userId}@test.local` },
      { id: B.userId, name: "Admin B", email: `${B.userId}@test.local` },
      { id: coachId, name: "Coach A", email: `${coachId}@test.local` },
    ],
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `ma-${run}`, name: "Salle A" },
      { id: B.tenantId, slug: `mb-${run}`, name: "Salle B" },
    ],
  });
  adminMembershipA = (
    await owner.tenantMembership.create({ data: { tenantId: A.tenantId, userId: A.userId, role: "ADMIN" } })
  ).id;
  coachMembershipA = (
    await owner.tenantMembership.create({ data: { tenantId: A.tenantId, userId: coachId, role: "COACH" } })
  ).id;
  await owner.tenantMembership.create({ data: { tenantId: B.tenantId, userId: B.userId, role: "ADMIN" } });
});

afterAll(async () => {
  const tenants = { in: [A.tenantId, B.tenantId] };
  await owner.member.deleteMany({ where: { tenantId: tenants } });
  await owner.auditLog.deleteMany({ where: { tenantId: tenants } });
  await owner.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  await owner.tenant.deleteMany({ where: { id: tenants } });
  await owner.user.deleteMany({ where: { id: { in: [A.userId, B.userId, coachId] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Adhérents", () => {
  it("attribue des codes séquentiels PAR salle", async () => {
    const a1 = await withTenant(A.tenantId, A.userId, (tx) => createMember(tx, A, input("+2250700000001")));
    const a2 = await withTenant(A.tenantId, A.userId, (tx) => createMember(tx, A, input("+2250700000002")));
    const b1 = await withTenant(B.tenantId, B.userId, (tx) => createMember(tx, B, input("+2250700000001")));
    expect([a1.code, a2.code, b1.code]).toEqual(["ADH-000001", "ADH-000002", "ADH-000001"]);
    expect(a1.consentUpdatedAt).not.toBeNull(); // consentement WhatsApp horodaté
  });

  it("refuse un téléphone déjà inscrit dans la même salle", async () => {
    await expect(
      withTenant(A.tenantId, A.userId, (tx) => createMember(tx, A, input("+2250700000001", "Doublon"))),
    ).rejects.toBeInstanceOf(BusinessError);
  });

  it("deux inscriptions simultanées n'obtiennent jamais le même code", async () => {
    const created = await Promise.all(
      [3, 4, 5, 6].map((n) =>
        withTenant(A.tenantId, A.userId, (tx) => createMember(tx, A, input(`+225070000000${n}`))),
      ),
    );
    expect(new Set(created.map((m) => m.code)).size).toBe(4);
  });

  it("une salle ne voit pas les adhérents d'une autre (même par identifiant)", async () => {
    const b2 = await withTenant(B.tenantId, B.userId, (tx) => createMember(tx, B, input("+2250799999999")));
    const seenFromA = await withTenant(A.tenantId, A.userId, (tx) => getMember(tx, b2.id));
    expect(seenFromA).toBeNull();
    const search = await withTenant(A.tenantId, A.userId, (tx) => searchMembers(tx, { q: "0799999999" }));
    expect(search.total).toBe(0);
  });

  it("recherche par chiffres du téléphone ou par code", async () => {
    const byPhone = await withTenant(A.tenantId, A.userId, (tx) => searchMembers(tx, { q: "07 00 00 00 02" }));
    expect(byPhone.items.map((m) => m.code)).toEqual(["ADH-000002"]);
    const byCode = await withTenant(A.tenantId, A.userId, (tx) => searchMembers(tx, { q: "adh-000001" }));
    expect(byCode.total).toBe(1);
  });

  it("archive puis restaure, avec historique", async () => {
    const m = await withTenant(A.tenantId, A.userId, (tx) => createMember(tx, A, input("+2250700000010")));
    await withTenant(A.tenantId, A.userId, (tx) => setMemberArchived(tx, A, m.id, true));
    const active = await withTenant(A.tenantId, A.userId, (tx) => searchMembers(tx, { q: "0700000010" }));
    expect(active.total).toBe(0);
    const archived = await withTenant(A.tenantId, A.userId, (tx) =>
      searchMembers(tx, { q: "0700000010", filter: "archives" }),
    );
    expect(archived.total).toBe(1);
    await withTenant(A.tenantId, A.userId, (tx) => setMemberArchived(tx, A, m.id, false));
    const actions = await owner.auditLog.findMany({ where: { entityId: m.id }, orderBy: { createdAt: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["member.create", "member.archive", "member.restore"]);
  });

  it("importe les lignes valides, ignore les doublons, ne présume aucun consentement", async () => {
    const csv = "nom;prenom;telephone\nDiallo;Fatou;0700000020\nKoné;Awa;0700000001\nYao;Kouassi;0700000021";
    const count = await withTenant(A.tenantId, A.userId, async (tx) => {
      const phones = new Set((await tx.member.findMany({ select: { phone: true } })).map((p) => p.phone));
      return importMembers(tx, A, analyzeMemberCsv(csv, phones));
    });
    expect(count).toBe(2);
    const imported = await owner.member.findMany({ where: { tenantId: A.tenantId, source: "IMPORT" } });
    expect(imported).toHaveLength(2);
    expect(imported.every((m) => !m.consentWhatsapp && !m.consentSms && !m.consentEmail)).toBe(true);
  });
});

describe("Équipe : garde-fous", () => {
  it("on ne peut pas modifier son propre accès", async () => {
    await expect(
      withTenant(A.tenantId, A.userId, (tx) => changeStaffRole(tx, A, adminMembershipA, "COACH")),
    ).rejects.toThrow(/propre accès/);
  });

  it("la salle garde toujours au moins un administrateur actif", async () => {
    const asCoach = { tenantId: A.tenantId, userId: coachId };
    // 1. L'admin promeut le coach administrateur (2 admins actifs).
    await withTenant(A.tenantId, A.userId, (tx) => changeStaffRole(tx, A, coachMembershipA, "ADMIN"));
    // 2. Le nouvel admin désactive l'admin d'origine : autorisé, il en reste un.
    await withTenant(A.tenantId, coachId, (tx) => setStaffStatus(tx, asCoach, adminMembershipA, "DISABLED"));
    // 3. Désactiver le DERNIER admin actif est refusé.
    await expect(
      withTenant(A.tenantId, A.userId, (tx) => setStaffStatus(tx, A, coachMembershipA, "DISABLED")),
    ).rejects.toThrow(/au moins un administrateur/);
  });
});
