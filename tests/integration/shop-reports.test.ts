/**
 * Sprint 11 — Boutique, rapports avancés et espace adhérent, contre PostgreSQL
 * (RLS actif, rôle applicatif).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, withTenant, type Tx } from "@/lib/db";
import { closeCashSession, currentCashView, openCashSession } from "@/modules/cash/cash.service";
import { createMember } from "@/modules/members/members.service";
import { createSelfRenewalLink, memberActivity, updateMyConsents } from "@/modules/members/member-space.service";
import { createPlan } from "@/modules/plans/plans.service";
import { comparePeriods, retentionCohorts, revenueByPlan, topProducts } from "@/modules/reports/reports.service";
import {
  adjustStock,
  createProduct,
  createSale,
  productSchema,
  restockProduct,
  saleSchema,
  voidSale,
} from "@/modules/shop/shop.service";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { assignSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

const owner = createPrismaClient(process.env.TEST_OWNER_DATABASE_URL!);
const run = randomUUID().slice(0, 8);
const A = { tenantId: randomUUID(), userId: `shop-mgr-${run}` };
const B = { tenantId: randomUUID(), userId: `shop-b-${run}` };
const MEMBER_USER = `shop-mbr-${run}`;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(A.tenantId, A.userId, fn);
const TODAY = todayCalendar();
const RANGE = { from: TODAY, to: new Date(TODAY.getTime() + 86_400_000) };

let memberId = "";
let memberCode = "";
let gourde = "";
let serviette = "";

const product = (name: string, price: number, trackStock = true) =>
  productSchema.parse({
    name,
    priceXof: String(price),
    lowStockThreshold: "3",
    ...(trackStock ? { trackStock: "on" } : {}),
    isActive: "on",
  });
const sale = (
  lines: { productId: string; quantity: number }[],
  method: "CASH" | "MOBILE_MONEY" = "CASH",
  memberCodeValue?: string,
) => saleSchema.parse({ lines: JSON.stringify(lines), method, ...(memberCodeValue ? { memberCode: memberCodeValue } : {}) });
const stockOf = async (id: string) => (await owner.product.findUniqueOrThrow({ where: { id } })).stockQty;

beforeAll(async () => {
  await owner.user.createMany({
    data: [A.userId, B.userId, MEMBER_USER].map((id) => ({ id, name: id, email: `${id}@test.local` })),
  });
  await owner.tenant.createMany({
    data: [
      { id: A.tenantId, slug: `shop-a-${run}`, name: "Boutique A" },
      { id: B.tenantId, slug: `shop-b-${run}`, name: "Boutique B" },
    ],
  });
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: A.tenantId, userId: A.userId, role: "MANAGER" },
      { tenantId: A.tenantId, userId: MEMBER_USER, role: "MEMBER" },
      { tenantId: B.tenantId, userId: B.userId, role: "ADMIN" },
    ],
  });
  await inA(async (tx) => {
    const plan = await createPlan(tx, A, {
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
    });
    const member = await createMember(tx, A, {
      firstName: "Awa",
      lastName: "Boutique",
      phone: "+2250166661001",
      email: null,
      birthDate: null,
      consentWhatsapp: false,
      consentSms: false,
      consentEmail: false,
    });
    memberId = member.id;
    memberCode = member.code;
    const sub = await assignSubscription(tx, A, { memberId: member.id, planId: plan.id, startDate: null }, TODAY);
    await recordManualPayment(tx, A, sub.id, { method: "MOBILE_MONEY", providerRef: `MM-${run}` });
  });
  await owner.member.update({ where: { id: memberId }, data: { userId: MEMBER_USER } });
});

afterAll(async () => {
  for (const tenantId of [A.tenantId, B.tenantId]) {
    const where = { tenantId };
    await owner.cashMovement.deleteMany({ where });
    await owner.cashSession.deleteMany({ where });
    await owner.stockMovement.deleteMany({ where });
    await owner.saleLine.deleteMany({ where });
    await owner.sale.deleteMany({ where });
    await owner.product.deleteMany({ where });
    await owner.renewalLink.deleteMany({ where });
    await owner.notification.deleteMany({ where });
    await owner.receipt.deleteMany({ where });
    await owner.payment.deleteMany({ where: { ...where, kind: "REFUND" } });
    await owner.payment.deleteMany({ where });
    await owner.subscription.updateMany({ where, data: { previousId: null } });
    await owner.subscription.deleteMany({ where });
    await owner.member.deleteMany({ where });
    await owner.membershipPlan.deleteMany({ where });
    await owner.auditLog.deleteMany({ where });
    await owner.tenantMembership.deleteMany({ where });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.user.deleteMany({ where: { id: { in: [A.userId, B.userId, MEMBER_USER] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("Catalogue et stock", () => {
  it("un produit naît à 0 ; le stock ne bouge que par des mouvements", async () => {
    gourde = (await inA((tx) => createProduct(tx, A, product("Gourde ZAHFIT", 3_000)))).id;
    serviette = (await inA((tx) => createProduct(tx, A, product("Location serviette", 500, false)))).id;
    await expect(inA((tx) => createProduct(tx, A, product("gourde zahfit", 1_000)))).rejects.toThrow(/déjà ce nom/);
    expect(await stockOf(gourde)).toBe(0);

    await inA((tx) => restockProduct(tx, A, { productId: gourde, quantity: 10, unitCostXof: 1_800, reason: null }));
    await inA((tx) => adjustStock(tx, A, { productId: gourde, quantity: -2, reason: "Casse" }));
    expect(await stockOf(gourde)).toBe(8);
    await expect(
      inA((tx) => adjustStock(tx, A, { productId: gourde, quantity: -50, reason: "Erreur" })),
    ).rejects.toThrow(/ne peut pas devenir négatif/);
    await expect(
      inA((tx) => restockProduct(tx, A, { productId: serviette, quantity: 5, unitCostXof: null, reason: null })),
    ).rejects.toThrow(/pas de suivi/);
  });

  it("la base refuse une modification directe du stock", async () => {
    await expect(inA((tx) => tx.product.update({ where: { id: gourde }, data: { stockQty: 999 } }))).rejects.toThrow();
    await expect(inA((tx) => tx.stockMovement.deleteMany({ where: { productId: gourde } }))).rejects.toThrow();
    expect(await stockOf(gourde)).toBe(8);
  });
});

describe("Ventes au comptoir", () => {
  let cashSaleId = "";

  it("prix relus en base, lignes regroupées, stock décrémenté, numéro continu", async () => {
    const first = await inA((tx) =>
      createSale(
        tx,
        A,
        sale(
          [
            { productId: gourde, quantity: 1 },
            { productId: gourde, quantity: 1 },
            { productId: serviette, quantity: 1 },
          ],
          "MOBILE_MONEY",
          memberCode,
        ),
      ),
    );
    expect(first).toMatchObject({ number: "VTE-000001", totalXof: 2 * 3_000 + 500, memberId });
    const lines = await owner.saleLine.findMany({ where: { saleId: first.id }, orderBy: { productName: "asc" } });
    expect(lines.map((l) => [l.productName, l.quantity, l.lineTotalXof])).toEqual([
      ["Gourde ZAHFIT", 2, 6_000],
      ["Location serviette", 1, 500],
    ]);
    expect(await stockOf(gourde)).toBe(6);
    expect(await stockOf(serviette)).toBe(0); // pas de suivi : aucun mouvement
  });

  it("stock insuffisant : refusé, sans consommer de numéro", async () => {
    await expect(inA((tx) => createSale(tx, A, sale([{ productId: gourde, quantity: 100 }])))).rejects.toThrow(
      /Stock insuffisant/,
    );
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: A.tenantId } })).saleSeq).toBe(1);
  });

  it("vente en espèces → caisse ; annulation → stock et caisse rétablis", async () => {
    await inA((tx) => openCashSession(tx, A, { openingFloatXof: 1_000 }));
    cashSaleId = (await inA((tx) => createSale(tx, A, sale([{ productId: gourde, quantity: 3 }])))).id;
    expect(await stockOf(gourde)).toBe(3);
    expect((await inA((tx) => currentCashView(tx)))!.balance).toBe(1_000 + 9_000);

    await inA((tx) => voidSale(tx, A, { saleId: cashSaleId, reason: "Erreur de saisie" }));
    await expect(inA((tx) => voidSale(tx, A, { saleId: cashSaleId, reason: "Encore" }))).rejects.toThrow(/déjà annulée/);
    expect(await stockOf(gourde)).toBe(6);
    const view = await inA((tx) => currentCashView(tx));
    expect(view!.balance).toBe(1_000);
    expect(view!.movements.map((m) => m.kind).sort()).toEqual(["SALE", "SALE_VOID"]);
    await inA((tx) => closeCashSession(tx, A, { countedXof: 1_000, closingNote: null }));
  });

  it("une vente et ses lignes sont figées (garanti par la base)", async () => {
    await expect(inA((tx) => tx.sale.update({ where: { id: cashSaleId }, data: { totalXof: 1 } }))).rejects.toThrow();
    await expect(
      inA((tx) => tx.saleLine.updateMany({ where: { saleId: cashSaleId }, data: { quantity: 1 } })),
    ).rejects.toThrow();
    await expect(inA((tx) => tx.sale.deleteMany({ where: { id: cashSaleId } }))).rejects.toThrow();
  });

  it("produit retiré de la vente : refusé", async () => {
    await inA((tx) => tx.product.update({ where: { id: serviette }, data: { isActive: false } }));
    await expect(inA((tx) => createSale(tx, A, sale([{ productId: serviette, quantity: 1 }])))).rejects.toThrow(
      /n'est plus en vente/,
    );
  });
});

describe("Rapports avancés", () => {
  it("comparaison de périodes, panier moyen, revenus par formule, produits", async () => {
    const { current } = await inA((tx) => comparePeriods(tx, RANGE));
    expect(current.shopRevenue).toBe(6_500); // la vente annulée ne compte pas
    expect(current.sales).toBe(1);
    expect(current.averageBasket).toBe(6_500);
    expect(current.subscriptionRevenue).toBe(20_000);
    expect(current.newMembers).toBe(1);

    expect(await inA((tx) => revenueByPlan(tx, RANGE))).toEqual([{ planName: "Mensuel", amountXof: 20_000, count: 1 }]);
    const products = await inA((tx) => topProducts(tx, RANGE));
    expect(products[0]).toMatchObject({ name: "Gourde ZAHFIT", quantity: 2, amountXof: 6_000 });
  });

  it("cohortes : l'adhérent du mois est retenu à 100 % le mois 0", async () => {
    const cohorts = await inA((tx) => retentionCohorts(tx, TODAY, 6));
    expect(cohorts).toHaveLength(6);
    const thisMonth = cohorts.at(-1)!;
    expect(thisMonth).toMatchObject({ size: 1 });
    expect(thisMonth.retention[0]).toBe(100);
    expect(thisMonth.retention[1]).toBeNull(); // mois futur
  });
});

describe("Espace adhérent", () => {
  it("historique : achats boutique de l'adhérent", async () => {
    const activity = await inA((tx) => memberActivity(tx, memberId, new Date()));
    expect(activity.purchases.map((p) => p.number)).toEqual(["VTE-000001"]);
  });

  it("consentements modifiés par l'adhérent, tracés", async () => {
    await withTenant(A.tenantId, MEMBER_USER, (tx) =>
      updateMyConsents(
        tx,
        { tenantId: A.tenantId, userId: MEMBER_USER },
        { consentWhatsapp: true, consentSms: false, consentEmail: true },
      ),
    );
    expect(await owner.member.findUniqueOrThrow({ where: { id: memberId } })).toMatchObject({
      consentWhatsapp: true,
      consentEmail: true,
    });
    expect(await owner.auditLog.count({ where: { entityId: memberId, action: "member.consent.update" } })).toBe(1);
  });

  it("renouvellement en ligne : lien à usage unique vers la dernière formule", async () => {
    const path = await withTenant(A.tenantId, MEMBER_USER, (tx) => createSelfRenewalLink(tx, A.tenantId, MEMBER_USER));
    expect(path).toMatch(new RegExp(`^/s/shop-a-${run}/renouveler/[A-Za-z0-9_-]{40,}$`));
  });

  it("isolation : une autre salle ne voit ni produits, ni ventes, ni stock", async () => {
    const seen = await withTenant(B.tenantId, B.userId, async (tx) => ({
      products: await tx.product.count(),
      sales: await tx.sale.count(),
      lines: await tx.saleLine.count(),
      movements: await tx.stockMovement.count(),
    }));
    expect(seen).toEqual({ products: 0, sales: 0, lines: 0, movements: 0 });
  });
});
