import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { VoidSaleForm } from "@/components/shop/shop-forms";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PERIODS, parsePeriod, periodRange, type Period } from "@/modules/payments/payments.service";
import { listSales } from "@/modules/shop/shop.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Ventes boutique" };

export default async function SalesPage({ searchParams }: PageProps<"/admin/boutique/ventes">) {
  const ctx = await requireSpace("admin", "SHOP");
  const canManage = can(ctx.role, "shop.manage");
  if (!canManage && !can(ctx.role, "finance.reports.read")) redirect("/admin");
  const period = parsePeriod((await searchParams).periode);
  const { rows, totals } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
    listSales(tx, periodRange(period, todayCalendar())),
  );

  return (
    <>
      <PageHeader title="Ventes boutique" description="Tickets de vente, annulations et panier moyen.">
        <Link href="/admin/boutique" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">
          Catalogue
        </Link>
      </PageHeader>

      <nav aria-label="Période" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <Link
            key={p}
            href={`/admin/boutique/ventes?periode=${p}`}
            aria-current={p === period ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", p === period ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {PERIODS[p]}
          </Link>
        ))}
      </nav>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Chiffre d'affaires" value={formatXof(totals.revenue)} hint="Ventes annulées exclues" />
        <StatCard label="Ventes" value={totals.count} />
        <StatCard label="Panier moyen" value={formatXof(totals.averageBasket)} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucune vente sur cette période.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => {
            const voided = s.status === "VOIDED";
            return (
              <li key={s.id} className={cn("rounded-xl border bg-card p-4", voided && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      <a
                        href={`/api/ventes/${s.id}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-brand hover:underline"
                      >
                        {s.number}
                      </a>{" "}
                      {voided && <Badge variant="destructive">Annulée</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(s.createdAt)} · {PAYMENT_METHOD_LABELS[s.method]} · {s.soldByName}
                      {s.member && (
                        <>
                          {" · "}
                          <Link href={`/admin/adherents/${s.member.id}`} className="hover:underline">
                            {s.member.lastName} {s.member.firstName}
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-sm">{s.lines.map((l) => `${l.quantity} × ${l.productName}`).join(", ")}</p>
                    {voided && <p className="mt-1 text-xs text-destructive">Motif : {s.voidReason}</p>}
                  </div>
                  <p className={cn("text-lg font-semibold whitespace-nowrap", voided && "line-through")}>
                    {formatXof(s.totalXof)}
                  </p>
                </div>
                {canManage && !voided && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Annuler la vente</summary>
                    <div className="mt-2 max-w-md">
                      <VoidSaleForm saleId={s.id} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
