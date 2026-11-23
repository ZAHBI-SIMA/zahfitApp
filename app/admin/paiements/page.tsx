import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PERIODS, listPayments, parsePeriod, periodRange, type Period } from "@/modules/payments/payments.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Paiements" };

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/paiements">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "payments.read")) redirect("/admin");
  const period = parsePeriod((await searchParams).periode);
  const { rows, totals } = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
    listPayments(tx, periodRange(period, todayCalendar())),
  );

  return (
    <>
      <PageHeader title="Paiements" description="Journal des encaissements et remboursements confirmés.">
        {can(ctx.role, "finance.reports.read") && (
          <a
            href={`/api/exports/paiements?periode=${period}`}
            download
            className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
          >
            Exporter (Excel / CSV)
          </a>
        )}
      </PageHeader>

      <nav aria-label="Période" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <Link
            key={p}
            href={`/admin/paiements?periode=${p}`}
            aria-current={p === period ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", p === period ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {PERIODS[p]}
          </Link>
        ))}
      </nav>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Encaissé" value={formatXof(totals.collected)} />
        <StatCard label="Remboursé" value={formatXof(totals.refunded)} />
        <StatCard label="Net" value={formatXof(totals.net)} hint="Encaissements − remboursements" />
      </div>
      {totals.byMethod.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {totals.byMethod.map((m) => (
            <span key={m.method}>
              {PAYMENT_METHOD_LABELS[m.method as PaymentMethod]} : <strong className="text-foreground">{formatXof(m.amount)}</strong>
            </span>
          ))}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucune transaction sur cette période.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Pièce</th>
                <th className="px-4 py-3 font-medium">Adhérent</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Formule</th>
                <th className="px-4 py-3 font-medium">Moyen</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Encaissé par</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(p.paidAt)}</td>
                  <td className="px-4 py-2">
                    {p.receipt ? (
                      <a href={`/api/recus/${p.receipt.id}`} target="_blank" rel="noopener" className="font-mono text-xs text-brand hover:underline">
                        {p.receipt.number}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/adherents/${p.member.id}`} className="hover:underline">
                      {p.member.lastName} {p.member.firstName}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">{p.subscription?.planName ?? "—"}</td>
                  <td className="px-4 py-2">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.providerRef && <span className="block text-xs text-muted-foreground">{p.providerRef}</span>}
                  </td>
                  <td className={cn("px-4 py-2 text-right whitespace-nowrap", p.kind === "REFUND" && "text-destructive")}>
                    {p.kind === "REFUND" ? "−" : ""}
                    {formatXof(p.amountXof)}
                  </td>
                  <td className="hidden px-4 py-2 lg:table-cell">{p.cashierName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
