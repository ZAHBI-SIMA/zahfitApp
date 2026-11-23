import type { Tx } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { addDays, isoDate } from "@/modules/subscriptions/dates";

/**
 * Rapports avancés (lecture seule, sous RLS). Les « recettes » suivent la
 * règle du journal des paiements : encaissements confirmés moins
 * remboursements, à leur date d'encaissement.
 *
 * Requêtes enchaînées, jamais en parallèle : une transaction PostgreSQL
 * n'exécute qu'une requête à la fois (pg avertit sinon).
 */

type Range = { from: Date; to: Date };

/** Période précédente de même durée, juste avant `range`. */
export function previousRange(range: Range): Range {
  const ms = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - ms), to: range.from };
}

async function periodMetrics(tx: Tx, range: Range) {
  const payments = await tx.payment.groupBy({
    by: ["kind"],
    where: { status: "SUCCEEDED", paidAt: { gte: range.from, lt: range.to } },
    _sum: { amountXof: true },
  });
  const sales = await tx.sale.aggregate({
    where: { status: "COMPLETED", createdAt: { gte: range.from, lt: range.to } },
    _sum: { totalXof: true },
    _count: { _all: true },
  });
  const expenses = await tx.expense.aggregate({
    where: { status: "RECORDED", spentOn: { gte: range.from, lte: addDays(range.to, -1) } },
    _sum: { amountXof: true },
  });
  const newMembers = await tx.member.count({ where: { createdAt: { gte: range.from, lt: range.to } } });
  const bookings = await tx.booking.count({
    where: { status: { not: "CANCELLED" }, createdAt: { gte: range.from, lt: range.to } },
  });
  const visits = await tx.accessLog.count({ where: { granted: true, occurredAt: { gte: range.from, lt: range.to } } });

  const sum = (kind: "PAYMENT" | "REFUND") => payments.find((p) => p.kind === kind)?._sum.amountXof ?? 0;
  const subscriptionRevenue = sum("PAYMENT") - sum("REFUND");
  const shopRevenue = sales._sum.totalXof ?? 0;
  const totalExpenses = expenses._sum.amountXof ?? 0;
  return {
    subscriptionRevenue,
    shopRevenue,
    expenses: totalExpenses,
    result: subscriptionRevenue + shopRevenue - totalExpenses,
    sales: sales._count._all,
    averageBasket: sales._count._all ? Math.round(shopRevenue / sales._count._all) : 0,
    newMembers,
    bookings,
    visits,
  };
}

export type PeriodMetrics = Awaited<ReturnType<typeof periodMetrics>>;

export async function comparePeriods(tx: Tx, range: Range) {
  const current = await periodMetrics(tx, range);
  const previous = await periodMetrics(tx, previousRange(range));
  return { current, previous };
}

/** Évolution en % (null si la période précédente est à 0 : variation non significative). */
export const variation = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100);

/** Recettes d'abonnement par formule (encaissements − remboursements). */
export async function revenueByPlan(tx: Tx, range: Range) {
  const payments = await tx.payment.findMany({
    where: { status: "SUCCEEDED", paidAt: { gte: range.from, lt: range.to }, subscriptionId: { not: null } },
    select: { kind: true, amountXof: true, subscription: { select: { planName: true } } },
  });
  const byPlan = new Map<string, { amountXof: number; count: number }>();
  for (const p of payments) {
    const name = p.subscription?.planName ?? "—";
    const entry = byPlan.get(name) ?? { amountXof: 0, count: 0 };
    entry.amountXof += p.kind === "REFUND" ? -p.amountXof : p.amountXof;
    if (p.kind === "PAYMENT") entry.count++;
    byPlan.set(name, entry);
  }
  return [...byPlan.entries()].map(([planName, v]) => ({ planName, ...v })).sort((a, b) => b.amountXof - a.amountXof);
}

/** Cours les plus réservés sur les séances (non annulées) de la période. */
export async function topClasses(tx: Tx, range: Range, take = 8) {
  const sessions = await tx.classSession.findMany({
    where: { startsAt: { gte: range.from, lt: range.to }, status: { not: "CANCELLED" } },
    select: {
      capacity: true,
      classType: { select: { name: true, color: true } },
      bookings: { where: { status: "CONFIRMED" }, select: { attendance: true } },
    },
  });
  const byClass = new Map<string, { color: string; sessions: number; bookings: number; capacity: number; present: number }>();
  for (const s of sessions) {
    const entry = byClass.get(s.classType.name) ?? { color: s.classType.color, sessions: 0, bookings: 0, capacity: 0, present: 0 };
    entry.sessions++;
    entry.bookings += s.bookings.length;
    entry.capacity += s.capacity;
    entry.present += s.bookings.filter((b) => b.attendance === "PRESENT").length;
    byClass.set(s.classType.name, entry);
  }
  return [...byClass.entries()]
    .map(([name, v]) => ({ name, ...v, fillRate: v.capacity ? Math.round((v.bookings / v.capacity) * 100) : 0 }))
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, take);
}

/** Produits les plus vendus (ventes non annulées). */
export async function topProducts(tx: Tx, range: Range, take = 8) {
  const lines = await tx.saleLine.groupBy({
    by: ["productName"],
    where: { sale: { status: "COMPLETED", createdAt: { gte: range.from, lt: range.to } } },
    _sum: { quantity: true, lineTotalXof: true },
  });
  return lines
    .map((l) => ({ name: l.productName, quantity: l._sum.quantity ?? 0, amountXof: l._sum.lineTotalXof ?? 0 }))
    .sort((a, b) => b.amountXof - a.amountXof)
    .slice(0, take);
}

/**
 * Cohortes de rétention : adhérents regroupés par mois de leur PREMIER
 * abonnement payé ; part encore abonnée (au moins un jour couvert) chacun
 * des mois suivants. Les abonnements annulés ou jamais payés ne comptent pas.
 */
export async function retentionCohorts(tx: Tx, today: Date, months = 6) {
  const firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1));
  const rows = await tx.$queryRaw<{ cohort: Date; m: number; size: number; retained: number }[]>(Prisma.sql`
    WITH paid AS (
      SELECT member_id, start_date, end_date FROM subscriptions
      WHERE status::text NOT IN ('CANCELLED', 'PENDING_PAYMENT')
    ),
    firsts AS (
      SELECT member_id, date_trunc('month', min(start_date))::date AS cohort FROM paid GROUP BY member_id
    ),
    sizes AS (SELECT cohort, count(*)::int AS size FROM firsts GROUP BY cohort),
    grid AS (
      SELECT f.member_id, f.cohort, k.m, (f.cohort + make_interval(months => k.m))::date AS month_start
      FROM firsts f CROSS JOIN generate_series(0, ${months - 1}::int) AS k(m)
      WHERE f.cohort >= ${firstMonth}::date AND (f.cohort + make_interval(months => k.m))::date <= ${today}::date
    )
    SELECT g.cohort, g.m, s.size,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM paid p WHERE p.member_id = g.member_id
          AND p.start_date <= (g.month_start + interval '1 month' - interval '1 day')::date
          AND p.end_date >= g.month_start
      ))::int AS retained
    FROM grid g JOIN sizes s ON s.cohort = g.cohort
    GROUP BY g.cohort, g.m, s.size
    ORDER BY g.cohort, g.m
  `);

  const cohorts = new Map<string, { cohort: string; size: number; retention: (number | null)[] }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
    const key = isoDate(d).slice(0, 7);
    cohorts.set(key, { cohort: key, size: 0, retention: Array.from({ length: months }, () => null) });
  }
  for (const r of rows) {
    const entry = cohorts.get(isoDate(r.cohort).slice(0, 7));
    if (!entry) continue;
    entry.size = r.size;
    entry.retention[r.m] = r.size ? Math.round((r.retained / r.size) * 100) : null;
  }
  return [...cohorts.values()];
}
