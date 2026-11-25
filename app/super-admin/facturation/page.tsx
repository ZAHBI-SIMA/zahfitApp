import type { Metadata } from "next";
import Link from "next/link";
import { MarkPaidForm, VoidSaasInvoiceForm } from "@/components/billing/billing-forms";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withPlatform } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { requireSuperAdmin } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listSaasInvoices, platformDashboard, type InvoiceFilter } from "@/modules/billing/billing.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Facturation" };

const FILTERS: Record<InvoiceFilter, string> = { ouvertes: "À régler", "en-retard": "En retard", toutes: "Toutes" };

export default async function PlatformBillingPage({ searchParams }: PageProps<"/super-admin/facturation">) {
  const user = await requireSuperAdmin();
  const wanted = (await searchParams).filtre;
  const filter: InvoiceFilter = wanted === "en-retard" || wanted === "toutes" ? wanted : "ouvertes";
  const today = todayCalendar();
  const { invoices, kpi } = await withPlatform(user.id, async (tx) => ({
    invoices: await listSaasInvoices(tx, filter, today),
    kpi: await platformDashboard(tx),
  }));

  return (
    <>
      <PageHeader title="Facturation ZahDigit" description="Factures des salles, règlements et retards." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Encours" value={formatXof(kpi.outstandingXof)} />
        <StatCard
          label="Dont en retard"
          value={formatXof(kpi.overdueXof)}
          hint={`${kpi.pastDue} salle(s) en retard, ${kpi.suspended} suspendue(s)`}
        />
        <StatCard
          label="Réussite des paiements de factures (30 j)"
          value={kpi.saasSuccessRate === null ? "—" : `${kpi.saasSuccessRate} %`}
        />
      </div>

      <nav aria-label="Filtre" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(FILTERS) as InvoiceFilter[]).map((f) => (
          <Link
            key={f}
            href={`/super-admin/facturation?filtre=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", f === filter ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {FILTERS[f]}
          </Link>
        ))}
      </nav>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Aucune facture.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((i) => {
            const late = i.status === "OPEN" && i.dueOn < today;
            return (
              <li key={i.id} className={cn("rounded-xl border bg-card p-4", i.status === "VOID" && "opacity-60")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      <a
                        href={`/api/factures-zahdigit/${i.id}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-brand hover:underline"
                      >
                        {i.number}
                      </a>{" "}
                      ·{" "}
                      <Link href={`/super-admin/salles/${i.tenant.id}`} className="hover:underline">
                        {i.tenant.name}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {i.kind === "SETUP" ? "Installation" : "Abonnement"} {i.planName} · émise le {formatDate(i.issuedOn)}{" "}
                      · échéance {formatDate(i.dueOn)}
                      {i.remindersSent.length > 0 && <> · relances : {i.remindersSent.join(", ")}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{formatXof(i.amountXof)}</p>
                    <Badge
                      variant={
                        i.status === "PAID" ? "secondary" : late ? "destructive" : i.status === "VOID" ? "outline" : "default"
                      }
                    >
                      {i.status === "PAID" ? "Réglée" : i.status === "VOID" ? "Annulée" : late ? "En retard" : "À régler"}
                    </Badge>
                  </div>
                </div>
                {i.status === "OPEN" && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Règlement reçu hors ligne ou annulation
                    </summary>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <MarkPaidForm invoiceId={i.id} />
                      <VoidSaasInvoiceForm invoiceId={i.id} />
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
