import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { PosTerminal } from "@/components/shop/pos-terminal";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listProducts } from "@/modules/shop/shop.service";

export const metadata: Metadata = { title: "Boutique" };

export default async function ReceptionShopPage() {
  const ctx = await requireSpace("reception", "SHOP");
  if (!can(ctx.role, "shop.sell")) redirect("/reception");
  const products = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => listProducts(tx, { activeOnly: true }));
  return (
    <>
      <PageHeader title="Boutique" description="Vente au comptoir : boissons, compléments, accessoires." />
      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucun article en vente : le gérant ajoute le catalogue dans Administration → Boutique.
        </div>
      ) : (
        <PosTerminal
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            priceXof: p.priceXof,
            trackStock: p.trackStock,
            stockQty: p.stockQty,
          }))}
        />
      )}
    </>
  );
}
