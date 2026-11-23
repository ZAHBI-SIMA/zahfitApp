"use server";

import * as z from "zod";
import { ok, requireActionContext, toFormState } from "@/lib/actions";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { parseForm, type FormState } from "@/lib/validation";
import {
  adjustStock,
  adjustmentSchema,
  createProduct,
  createSale,
  productSchema,
  restockProduct,
  restockSchema,
  saleSchema,
  updateProduct,
  voidSale,
  voidSaleSchema,
} from "@/modules/shop/shop.service";

const actorOf = (ctx: { tenant: { id: string }; user: { id: string } }) => ({ tenantId: ctx.tenant.id, userId: ctx.user.id });

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("shop.manage");
    const parsed = parseForm(productSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => createProduct(tx, actorOf(ctx), parsed.data));
    return ok(
      parsed.data.trackStock
        ? "Produit ajouté. Enregistrez maintenant une réception pour son stock initial."
        : "Produit ajouté.",
    );
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("shop.manage");
    const id = z.uuid().safeParse(formData.get("productId"));
    if (!id.success) return { ok: false, message: "Produit introuvable." };
    const parsed = parseForm(productSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => updateProduct(tx, actorOf(ctx), id.data, parsed.data));
    return ok("Produit enregistré.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function restockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("shop.manage");
    const parsed = parseForm(restockSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => restockProduct(tx, actorOf(ctx), parsed.data));
    return ok(`Réception de ${parsed.data.quantity} article(s) enregistrée.`);
  } catch (error) {
    return toFormState(error);
  }
}

export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("shop.manage");
    const parsed = parseForm(adjustmentSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => adjustStock(tx, actorOf(ctx), parsed.data));
    return ok("Ajustement de stock enregistré.");
  } catch (error) {
    return toFormState(error);
  }
}

export type SaleFormState = FormState & { saleId?: string; saleNumber?: string };

export async function createSaleAction(_prev: SaleFormState, formData: FormData): Promise<SaleFormState> {
  try {
    const ctx = await requireActionContext("shop.sell");
    const parsed = parseForm(saleSchema, formData);
    if (parsed.state) return parsed.state;
    const sale = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => createSale(tx, actorOf(ctx), parsed.data));
    return { ...ok(`Vente ${sale.number} enregistrée : ${formatXof(sale.totalXof)}.`), saleId: sale.id, saleNumber: sale.number };
  } catch (error) {
    return toFormState(error);
  }
}

export async function voidSaleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireActionContext("shop.manage");
    const parsed = parseForm(voidSaleSchema, formData);
    if (parsed.state) return parsed.state;
    await withTenant(ctx.tenant.id, ctx.user.id, (tx) => voidSale(tx, actorOf(ctx), parsed.data));
    return ok("Vente annulée : articles remis en stock.");
  } catch (error) {
    return toFormState(error);
  }
}
