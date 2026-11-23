import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { checkbox, optionalText, requiredText } from "@/lib/validation";
import { recordCashMovement } from "@/modules/cash/cash.service";

type Actor = { tenantId: string; userId: string };

/**
 * Boutique : catalogue, stock et ventes au comptoir.
 *
 * Garanties côté base (migration 20261224080100) : le stock ne change que par
 * un mouvement (jamais négatif), une vente et ses lignes sont figées (seule
 * l'annulation est possible), une vente en espèces entre dans la caisse.
 */

const intField = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .transform((v) => v.replace(/[\s  ]/g, ""))
    .refine((v) => /^-?\d+$/.test(v), `${label} : nombre entier attendu.`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} invalide.`);

const optionalAmount = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? Number(v.replace(/[^\d]/g, "")) : null))
  .refine((n) => n === null || (Number.isInteger(n) && n <= 10_000_000), "Montant invalide.");

export const productSchema = z.object({
  name: requiredText("Le nom", 80),
  category: optionalText(40),
  priceXof: intField("Le prix", { min: 0, max: 10_000_000 }),
  costXof: optionalAmount,
  trackStock: checkbox,
  lowStockThreshold: intField("Le seuil d'alerte", { min: 0, max: 100_000 }),
  isActive: checkbox,
});

export const restockSchema = z.object({
  productId: z.uuid(),
  quantity: intField("La quantité", { min: 1, max: 100_000 }),
  unitCostXof: optionalAmount,
  reason: optionalText(120),
});

export const adjustmentSchema = z.object({
  productId: z.uuid(),
  quantity: intField("L'écart", { min: -100_000, max: 100_000 }).refine((n) => n !== 0, "L'écart ne peut pas être nul."),
  reason: requiredText("Le motif", 120),
});

export const saleSchema = z.object({
  lines: z
    .string({ error: "Le panier est vide." })
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Panier illisible." });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(1000) }))
        .min(1, "Le panier est vide.")
        .max(50, "50 articles différents au maximum."),
    ),
  method: z.enum(["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"], { error: "Choisissez le moyen de paiement." }),
  reference: optionalText(80),
  memberCode: optionalText(20),
});

export const voidSaleSchema = z.object({ saleId: z.uuid(), reason: requiredText("Le motif", 200) });

export const saleNumber = (seq: number) => `VTE-${String(seq).padStart(6, "0")}`;

// --- Catalogue -----------------------------------------------------------------

export function listProducts(tx: Tx, { activeOnly = false } = {}) {
  return tx.product.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
  });
}

export const isLowStock = (p: { trackStock: boolean; stockQty: number; lowStockThreshold: number; isActive: boolean }) =>
  p.isActive && p.trackStock && p.stockQty <= p.lowStockThreshold;

async function assertUniqueName(tx: Tx, name: string, exceptId?: string) {
  const duplicate = await tx.product.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new BusinessError("Un produit porte déjà ce nom.", "name");
}

export async function createProduct(tx: Tx, actor: Actor, input: z.infer<typeof productSchema>) {
  await assertUniqueName(tx, input.name);
  const product = await tx.product.create({ data: { ...input, tenantId: actor.tenantId } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "product.create",
    entityType: "product",
    entityId: product.id,
    after: { name: input.name, priceXof: input.priceXof, trackStock: input.trackStock },
  });
  return product;
}

export async function updateProduct(tx: Tx, actor: Actor, productId: string, input: z.infer<typeof productSchema>) {
  const before = await tx.product.findUnique({ where: { id: productId } });
  if (!before) throw new BusinessError("Produit introuvable.");
  await assertUniqueName(tx, input.name, productId);
  if (!input.trackStock && before.stockQty !== 0) {
    throw new BusinessError("Remettez d'abord le stock à 0 (ajustement) avant d'arrêter le suivi.", "trackStock");
  }
  const product = await tx.product.update({ where: { id: productId }, data: input });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "product.update",
    entityType: "product",
    entityId: productId,
    before: { name: before.name, priceXof: before.priceXof, isActive: before.isActive },
    after: { name: input.name, priceXof: input.priceXof, isActive: input.isActive },
  });
  return product;
}

// --- Stock -----------------------------------------------------------------------

async function lockProducts(tx: Tx, ids: string[]) {
  // Ordre fixe : deux ventes simultanées verrouillent dans le même ordre (pas d'interblocage).
  const sorted = [...new Set(ids)].sort();
  await tx.$executeRaw`SELECT 1 FROM products WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function restockProduct(tx: Tx, actor: Actor, input: z.infer<typeof restockSchema>) {
  await lockProducts(tx, [input.productId]);
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new BusinessError("Produit introuvable.");
  if (!product.trackStock) throw new BusinessError("Ce produit n'a pas de suivi de stock.");
  const movement = await tx.stockMovement.create({
    data: {
      tenantId: actor.tenantId,
      productId: product.id,
      kind: "RESTOCK",
      quantity: input.quantity,
      unitCostXof: input.unitCostXof,
      reason: input.reason,
      createdById: actor.userId,
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "stock.restock",
    entityType: "product",
    entityId: product.id,
    after: { quantity: input.quantity, unitCostXof: input.unitCostXof, stockAfter: product.stockQty + input.quantity },
  });
  return movement;
}

/** Inventaire, casse, vol : écart signé, motif obligatoire. */
export async function adjustStock(tx: Tx, actor: Actor, input: z.infer<typeof adjustmentSchema>) {
  await lockProducts(tx, [input.productId]);
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new BusinessError("Produit introuvable.");
  if (!product.trackStock) throw new BusinessError("Ce produit n'a pas de suivi de stock.");
  if (product.stockQty + input.quantity < 0) {
    throw new BusinessError(`Stock actuel : ${product.stockQty}. Il ne peut pas devenir négatif.`, "quantity");
  }
  await tx.stockMovement.create({
    data: {
      tenantId: actor.tenantId,
      productId: product.id,
      kind: "ADJUSTMENT",
      quantity: input.quantity,
      reason: input.reason,
      createdById: actor.userId,
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "stock.adjust",
    entityType: "product",
    entityId: product.id,
    before: { stock: product.stockQty },
    after: { quantity: input.quantity, reason: input.reason, stock: product.stockQty + input.quantity },
  });
}

export async function listStockMovements(tx: Tx, take = 50) {
  const movements = await tx.stockMovement.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { product: { select: { name: true } }, sale: { select: { number: true } } },
  });
  const ids = [...new Set(movements.map((m) => m.createdById).filter((id): id is string => !!id))];
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return movements.map((m) => ({ ...m, createdByName: m.createdById ? (names.get(m.createdById) ?? "—") : "—" }));
}

// --- Ventes ----------------------------------------------------------------------

/**
 * Vente au comptoir. Le navigateur n'envoie que des identifiants et des
 * quantités : les prix sont relus en base puis FIGÉS dans les lignes.
 */
export async function createSale(tx: Tx, actor: Actor, input: z.infer<typeof saleSchema>) {
  // Lignes en double (même produit ajouté deux fois) : regroupées.
  const quantities = new Map<string, number>();
  for (const l of input.lines) quantities.set(l.productId, (quantities.get(l.productId) ?? 0) + l.quantity);

  await lockProducts(tx, [...quantities.keys()]);
  const products = await tx.product.findMany({ where: { id: { in: [...quantities.keys()] } } });
  if (products.length !== quantities.size) throw new BusinessError("Un article du panier n'existe plus.");
  for (const p of products) {
    const qty = quantities.get(p.id)!;
    if (!p.isActive) throw new BusinessError(`« ${p.name} » n'est plus en vente.`);
    if (p.trackStock && p.stockQty < qty) {
      throw new BusinessError(`Stock insuffisant pour « ${p.name} » : ${p.stockQty} disponible(s).`);
    }
  }
  const total = products.reduce((s, p) => s + p.priceXof * quantities.get(p.id)!, 0);
  if (total <= 0) throw new BusinessError("Le total de la vente doit être supérieur à 0.");

  let memberId: string | null = null;
  if (input.memberCode) {
    const member = await tx.member.findFirst({
      where: { code: { equals: input.memberCode.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (!member) throw new BusinessError("Aucun adhérent avec ce code.", "memberCode");
    memberId = member.id;
  }

  // Numéro continu, incrémenté dans la transaction : une vente échouée ne consomme pas de numéro.
  const { saleSeq } = await tx.tenant.update({
    where: { id: actor.tenantId },
    data: { saleSeq: { increment: 1 } },
    select: { saleSeq: true },
  });
  const sale = await tx.sale.create({
    data: {
      tenantId: actor.tenantId,
      number: saleNumber(saleSeq),
      memberId,
      totalXof: total,
      method: input.method,
      reference: input.reference,
      soldById: actor.userId,
    },
  });
  await tx.saleLine.createMany({
    data: products.map((p) => ({
      tenantId: actor.tenantId,
      saleId: sale.id,
      productId: p.id,
      productName: p.name,
      unitPriceXof: p.priceXof,
      quantity: quantities.get(p.id)!,
      lineTotalXof: p.priceXof * quantities.get(p.id)!,
    })),
  });
  const tracked = products.filter((p) => p.trackStock);
  if (tracked.length > 0) {
    await tx.stockMovement.createMany({
      data: tracked.map((p) => ({
        tenantId: actor.tenantId,
        productId: p.id,
        kind: "SALE" as const,
        quantity: -quantities.get(p.id)!,
        saleId: sale.id,
        createdById: actor.userId,
      })),
    });
  }
  if (input.method === "CASH") {
    await recordCashMovement(tx, actor, { kind: "SALE", amountXof: total, label: `${sale.number} — boutique`, saleId: sale.id });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "sale.create",
    entityType: "sale",
    entityId: sale.id,
    after: { number: sale.number, totalXof: total, method: input.method, items: quantities.size },
  });
  return sale;
}

/**
 * Annulation (erreur, retour d'article) : les articles reviennent en stock et,
 * payée en espèces, la somme sort de la caisse OUVERTE (contre-passation).
 */
export async function voidSale(tx: Tx, actor: Actor, input: z.infer<typeof voidSaleSchema>) {
  const sale = await tx.sale.findUnique({ where: { id: input.saleId } });
  if (!sale) throw new BusinessError("Vente introuvable.");
  const updated = await tx.sale.updateMany({
    where: { id: sale.id, status: "COMPLETED" },
    data: { status: "VOIDED", voidReason: input.reason, voidedById: actor.userId, voidedAt: new Date() },
  });
  if (updated.count === 0) throw new BusinessError("Cette vente est déjà annulée.");

  const sold = await tx.stockMovement.findMany({ where: { saleId: sale.id, kind: "SALE" } });
  if (sold.length > 0) {
    await lockProducts(tx, sold.map((m) => m.productId));
    await tx.stockMovement.createMany({
      data: sold.map((m) => ({
        tenantId: actor.tenantId,
        productId: m.productId,
        kind: "SALE_VOID" as const,
        quantity: -m.quantity,
        saleId: sale.id,
        reason: input.reason,
        createdById: actor.userId,
      })),
    });
  }
  if (sale.method === "CASH") {
    await recordCashMovement(tx, actor, {
      kind: "SALE_VOID",
      amountXof: -sale.totalXof,
      label: `Annulation ${sale.number}`,
      saleId: sale.id,
    });
  }
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "sale.void",
    entityType: "sale",
    entityId: sale.id,
    before: { number: sale.number, totalXof: sale.totalXof },
    after: { reason: input.reason },
  });
}

const saleInclude = {
  lines: { orderBy: { productName: "asc" } },
  member: { select: { id: true, code: true, firstName: true, lastName: true, userId: true } },
} satisfies Prisma.SaleInclude;

export async function listSales(tx: Tx, range: { from: Date; to: Date }) {
  const sales = await tx.sale.findMany({
    where: { createdAt: { gte: range.from, lt: range.to } },
    orderBy: { createdAt: "desc" },
    include: saleInclude,
  });
  const ids = [...new Set(sales.map((s) => s.soldById))];
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const completed = sales.filter((s) => s.status === "COMPLETED");
  const revenue = completed.reduce((s, x) => s + x.totalXof, 0);
  return {
    rows: sales.map((s) => ({ ...s, soldByName: names.get(s.soldById) ?? "—" })),
    totals: {
      revenue,
      count: completed.length,
      averageBasket: completed.length ? Math.round(revenue / completed.length) : 0,
    },
  };
}

export async function loadSale(tx: Tx, saleId: string) {
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: saleInclude });
  if (!sale) return null;
  const seller = await tx.user.findUnique({ where: { id: sale.soldById }, select: { name: true } });
  return { ...sale, soldByName: seller?.name ?? "—" };
}

export type LoadedSale = NonNullable<Awaited<ReturnType<typeof loadSale>>>;
