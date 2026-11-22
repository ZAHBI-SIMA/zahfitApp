/**
 * Suite « aucune fuite de données entre salles » (section 14 du cahier des
 * charges). Elle vérifie le RLS au niveau de PostgreSQL lui-même : même un
 * code applicatif qui oublierait un filtre `tenantId` ne verrait rien.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "@/lib/audit";
import { createPrismaClient, prisma, withPlatform, withTenant, withUser } from "@/lib/db";

// Client PROPRIÉTAIRE (contourne le RLS) : uniquement pour préparer les données.
const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);

const run = randomUUID().slice(0, 8);
const ids = {
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  userA: `user-a-${run}`,
  userB: `user-b-${run}`,
  platformUser: `platform-${run}`,
};

beforeAll(async () => {
  await owner.user.createMany({
    data: [
      { id: ids.userA, name: "A", email: `a-${run}@test.local` },
      { id: ids.userB, name: "B", email: `b-${run}@test.local` },
      { id: ids.platformUser, name: "P", email: `p-${run}@test.local`, platformRole: "SUPER_ADMIN" },
    ],
  });
  await owner.tenant.createMany({
    data: [
      { id: ids.tenantA, slug: `a-${run}`, name: "Salle A" },
      { id: ids.tenantB, slug: `b-${run}`, name: "Salle B" },
    ],
  });
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: ids.tenantA, userId: ids.userA, role: "ADMIN" },
      { tenantId: ids.tenantB, userId: ids.userB, role: "ADMIN" },
    ],
  });
  await owner.auditLog.createMany({
    data: [
      { tenantId: ids.tenantA, action: "test.a" },
      { tenantId: ids.tenantB, action: "test.b" },
    ],
  });
});

afterAll(async () => {
  await owner.auditLog.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await owner.tenantMembership.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await owner.tenant.deleteMany({ where: { id: { in: [ids.tenantA, ids.tenantB] } } });
  await owner.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Isolation multi-tenant (RLS)", () => {
  it("sans contexte, le rôle applicatif ne voit aucune donnée métier", async () => {
    expect(await prisma.tenant.count({ where: { id: { in: [ids.tenantA, ids.tenantB] } } })).toBe(0);
    expect(await prisma.tenantMembership.count({ where: { userId: ids.userA } })).toBe(0);
  });

  it("la salle A ne voit que ses propres appartenances", async () => {
    const rows = await withTenant(ids.tenantA, ids.userA, (tx) =>
      tx.tenantMembership.findMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } }),
    );
    expect(rows.map((r) => r.tenantId)).toEqual([ids.tenantA]);
  });

  it("la salle A ne peut pas écrire dans la salle B", async () => {
    await expect(
      withTenant(ids.tenantA, ids.userA, (tx) =>
        tx.tenantMembership.create({
          data: { tenantId: ids.tenantB, userId: ids.userA, role: "ADMIN" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("la salle A ne peut pas modifier une ligne de la salle B", async () => {
    const result = await withTenant(ids.tenantA, ids.userA, (tx) =>
      tx.tenantMembership.updateMany({
        where: { tenantId: ids.tenantB },
        data: { status: "DISABLED" },
      }),
    );
    expect(result.count).toBe(0);
  });

  it("un utilisateur sans salle active ne voit que SES salles", async () => {
    const tenants = await withUser(ids.userB, (tx) =>
      tx.tenant.findMany({ where: { id: { in: [ids.tenantA, ids.tenantB] } } }),
    );
    expect(tenants.map((t) => t.id)).toEqual([ids.tenantB]);
  });

  it("le contexte ne fuit pas hors de sa transaction", async () => {
    await withTenant(ids.tenantA, ids.userA, (tx) => tx.tenant.count());
    expect(await prisma.tenant.count({ where: { id: ids.tenantA } })).toBe(0);
  });

  it("le journal d'audit est cloisonné et en ajout seul", async () => {
    const visible = await withTenant(ids.tenantA, ids.userA, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } }),
    );
    expect(visible.map((l) => l.action)).toEqual(["test.a"]);

    await expect(
      withTenant(ids.tenantA, ids.userA, (tx) =>
        tx.auditLog.deleteMany({ where: { tenantId: ids.tenantA } }),
      ),
    // SQLSTATE 42501 = insufficient_privilege. On teste le code et non le
    // texte : il est traduit selon lc_messages (« droit refusé » en français).
    ).rejects.toThrow(/42501/);
  });

  it("un événement plateforme (connexion) se journalise sans salle active", async () => {
    await withUser(ids.userA, (tx) =>
      audit(tx, { actorUserId: ids.userA, action: `auth.login.${run}` }),
    );
    const logged = await owner.auditLog.count({ where: { action: `auth.login.${run}` } });
    expect(logged).toBe(1);
    await owner.auditLog.deleteMany({ where: { action: `auth.login.${run}` } });
  });

  it("le contexte plateforme (Super Admin) voit toutes les salles", async () => {
    const count = await withPlatform(ids.platformUser, (tx) =>
      tx.tenant.count({ where: { id: { in: [ids.tenantA, ids.tenantB] } } }),
    );
    expect(count).toBe(2);
  });

  it("une salle ne peut pas créer une autre salle", async () => {
    await expect(
      withTenant(ids.tenantA, ids.userA, (tx) =>
        tx.tenant.create({ data: { slug: `x-${run}`, name: "Pirate" } }),
      ),
    ).rejects.toThrow();
  });
});
