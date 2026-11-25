import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PERIODS, parsePeriod, periodRange, type Period } from "@/modules/payments/payments.service";
import {
  comparePeriods,
  retentionCohorts,
  revenueByPlan,
  topClasses,
  topProducts,
  variation,
  type PeriodMetrics,
} from "@/modules/reports/reports.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Statistiques" };

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const METRICS: { key: keyof PeriodMetrics; label: string; money?: boolean; lowerIsBetter?: boolean }[] = [
  { key: "subscriptionRevenue", label: "Recettes abonnements", money: true },
  { key: "shopRevenue", label: "Ventes boutique", money: true },
  { key: "expenses", label: "Dépenses", money: true, lowerIsBetter: true },
  { key: "result", label: "Résultat", money: true },
  { key: "averageBasket", label: "Panier moyen boutique", money: true },
  { key: "newMembers", label: "Nouveaux adhérents" },
  { key: "bookings", label: "Réservations" },
  { key: "visits", label: "Entrées" },
];

/** Barre horizontale proportionnelle (sans bibliothèque de graphiques). */
function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-muted" aria-hidden>
      <div className="h-2 rounded-full bg-brand" style={{ width: `${width}%`, ...(color ? { backgroundColor: color } : {}) }} />
    </div>
  );
}

export default async function StatsPage({ searchParams }: PageProps<"/admin/statistiques">) {
  const ctx = await requireSpace("admin", "ADVANCED_REPORTS");
  if (!can(ctx.role, "finance.reports.read")) redirect("/admin");
  const period = parsePeriod((await searchParams).periode ?? "mois");
  const today = todayCalendar();
  const range = periodRange(period, today);

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    comparison: await comparePeriods(tx, range),
    plans: await revenueByPlan(tx, range),
    classes: await topClasses(tx, range),
    products: await topProducts(tx, range),
    cohorts: await retentionCohorts(tx, today, 6),
  }));
  const { current, previous } = data.comparison;
  const maxPlan = Math.max(0, ...data.plans.map((p) => p.amountXof));
  const maxClass = Math.max(0, ...data.classes.map((c) => c.bookings));
  const maxProduct = Math.max(0, ...data.products.map((p) => p.amountXof));

  return (
    <>
      <PageHeader title="Statistiques" description="Comparaison avec la période précédente de même durée." />

      <nav aria-label="Période" className="mb-6 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <Link
            key={p}
            href={`/admin/statistiques?periode=${p}`}
            aria-current={p === period ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", p === period ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {PERIODS[p]}
          </Link>
        ))}
      </nav>

      <section aria-label="Indicateurs" className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((m) => {
          const value = current[m.key];
          const delta = variation(value, previous[m.key]);
          const good = delta === null || delta === 0 ? null : delta > 0 !== Boolean(m.lowerIsBetter);
          return (
            <div key={m.key} className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-2xl font-semibold">{m.money ? formatXof(value) : value}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {delta === null ? (
                  "Pas de comparaison"
                ) : (
                  <span
                    className={cn(good === true && "text-green-700 dark:text-green-400", good === false && "text-destructive")}
                  >
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {Math.abs(delta)} %
                  </span>
                )}{" "}
                · avant : {m.money ? formatXof(previous[m.key]) : previous[m.key]}
              </p>
            </div>
          );
        })}
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="par-formule">
          <h2 id="par-formule" className="mb-4 text-sm font-medium">
            Recettes par formule
          </h2>
          {data.plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun encaissement sur la période.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {data.plans.map((p) => (
                <li key={p.planName}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>
                      {p.planName} <span className="text-xs text-muted-foreground">({p.count} paiement(s))</span>
                    </span>
                    <strong>{formatXof(p.amountXof)}</strong>
                  </div>
                  <Bar value={p.amountXof} max={maxPlan} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5" aria-labelledby="cours">
          <h2 id="cours" className="mb-4 text-sm font-medium">
            Cours les plus réservés
          </h2>
          {data.classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune séance sur la période.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {data.classes.map((c) => (
                <li key={c.name}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>
                      {c.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {c.sessions} séance(s) · remplissage {c.fillRate} % · {c.present} présent(s)
                      </span>
                    </span>
                    <strong>{c.bookings}</strong>
                  </div>
                  <Bar value={c.bookings} max={maxClass} color={c.color} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 lg:col-span-2" aria-labelledby="produits">
          <h2 id="produits" className="mb-4 text-sm font-medium">
            Produits les plus vendus
          </h2>
          {data.products.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune vente boutique sur la période.</p>
          ) : (
            <ul className="grid gap-3 text-sm md:grid-cols-2">
              {data.products.map((p) => (
                <li key={p.name}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>
                      {p.name} <span className="text-xs text-muted-foreground">× {p.quantity}</span>
                    </span>
                    <strong>{formatXof(p.amountXof)}</strong>
                  </div>
                  <Bar value={p.amountXof} max={maxProduct} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-card p-5" aria-labelledby="cohortes">
        <h2 id="cohortes" className="mb-1 text-sm font-medium">
          Rétention par cohorte
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Adhérents regroupés par mois de leur premier abonnement payé ; part encore abonnée les mois suivants.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Cohorte</th>
                <th className="px-2 py-2 font-medium">Adhérents</th>
                {data.cohorts.map((_, i) => (
                  <th key={i} className="px-2 py-2 font-medium">
                    M+{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.cohort}>
                  <td className="px-2 py-1 text-left whitespace-nowrap">{monthLabel(c.cohort)}</td>
                  <td className="px-2 py-1">{c.size}</td>
                  {c.retention.map((r, i) => (
                    <td key={i} className="px-1 py-1">
                      {r === null || c.size === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className="block rounded px-1 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: `color-mix(in oklab, var(--color-brand) ${Math.round(r * 0.6)}%, transparent)`,
                          }}
                        >
                          {r} %
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
