import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { AdjustStockForm, ProductForm, RestockForm } from "@/components/shop/shop-forms";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { isLowStock, listProducts, listStockMovements } from "@/modules/shop/shop.service";

export const metadata: Metadata = { title: "Boutique" };

const KIND_LABELS = { RESTOCK: "Réception", SALE: "Vente", SALE_VOID: "Vente annulée", ADJUSTMENT: "Ajustement" } as const;

export default async function AdminShopPage() {
  const ctx = await requireSpace("admin");
  const canManage = can(ctx.role, "shop.manage");
  if (!canManage && !can(ctx.role, "finance.reports.read")) redirect("/admin");
  const { products, movements } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    products: await listProducts(tx),
    movements: await listStockMovements(tx, 30),
  }));
  const low = products.filter(isLowStock);
  const stockValue = products
    .filter((p) => p.isActive && p.trackStock)
    .reduce((s, p) => s + p.stockQty * (p.costXof ?? p.priceXof), 0);

  return (
    <>
      <PageHeader title="Boutique" description="Catalogue, stock et réceptions. La vente se fait depuis l'accueil.">
        <Link
          href="/admin/boutique/ventes"
          className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
        >
          Historique des ventes
        </Link>
      </PageHeader>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Articles en vente" value={products.filter((p) => p.isActive).length} />
        <StatCard label="Stock à réapprovisionner" value={low.length} hint={low.length ? "Seuil d'alerte atteint" : "Rien à signaler"} />
        <StatCard label="Valeur du stock" value={formatXof(stockValue)} hint="Au prix d'achat (à défaut, au prix de vente)" />
      </div>

      {low.length > 0 && (
        <div role="alert" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">Stock bas :</p>
          <p className="text-muted-foreground">{low.map((p) => `${p.name} (${p.stockQty})`).join(" · ")}</p>
        </div>
      )}

      {canManage && (
        <section className="mb-8 rounded-xl border bg-card p-5" aria-labelledby="nouveau-produit">
          <h2 id="nouveau-produit" className="mb-1 text-sm font-medium">
            Nouveau produit
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Le stock part de 0 : enregistrez ensuite une réception pour la quantité reçue (traçabilité).
          </p>
          <ProductForm />
        </section>
      )}

      <h2 className="mb-2 text-sm font-medium">Catalogue ({products.length})</h2>
      {products.length === 0 ? (
        <div className="mb-8 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucun produit pour le moment.
        </div>
      ) : (
        <ul className="mb-8 flex flex-col gap-3">
          {products.map((p) => (
            <li key={p.id} className={cn("rounded-xl border bg-card p-4", !p.isActive && "opacity-70")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {p.name} {!p.isActive && <Badge variant="outline">Retiré de la vente</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.category ?? "Sans catégorie"} · {formatXof(p.priceXof)}
                    {p.costXof !== null && <> · achat {formatXof(p.costXof)}</>}
                  </p>
                </div>
                <p className={cn("text-sm font-semibold", isLowStock(p) && "text-destructive")}>
                  {p.trackStock ? `${p.stockQty} en stock` : "Sans suivi de stock"}
                  {p.trackStock && (
                    <span className="block text-xs font-normal text-muted-foreground">alerte à {p.lowStockThreshold}</span>
                  )}
                </p>
              </div>
              {canManage && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Modifier, réceptionner, ajuster</summary>
                  <div className="mt-3 flex flex-col gap-4">
                    <ProductForm
                      product={{
                        id: p.id,
                        name: p.name,
                        category: p.category,
                        priceXof: p.priceXof,
                        costXof: p.costXof,
                        trackStock: p.trackStock,
                        lowStockThreshold: p.lowStockThreshold,
                        isActive: p.isActive,
                      }}
                    />
                    {p.trackStock && (
                      <>
                        <RestockForm productId={p.id} />
                        <AdjustStockForm productId={p.id} />
                      </>
                    )}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-sm font-medium">Derniers mouvements de stock</h2>
      {movements.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun mouvement.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Produit</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Quantité</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Détail</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2">{m.product.name}</td>
                  <td className="px-4 py-2">{KIND_LABELS[m.kind]}</td>
                  <td className={cn("px-4 py-2 text-right", m.quantity < 0 && "text-destructive")}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </td>
                  <td className="hidden px-4 py-2 text-xs text-muted-foreground md:table-cell">
                    {[m.sale?.number, m.reason, m.createdByName].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
