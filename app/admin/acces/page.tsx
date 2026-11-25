import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ACCESS_METHOD_LABELS, ACCESS_REASON_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { accessOverview, listAccessLogs } from "@/modules/access/access.service";

export const metadata: Metadata = { title: "Fréquentation" };

const FILTERS = [
  { value: "tous", label: "Tous", granted: undefined },
  { value: "entrees", label: "Entrées", granted: true },
  { value: "refus", label: "Refus", granted: false },
] as const;

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** Histogramme à une série : barres fines, extrémité arrondie, valeur max étiquetée, infobulle au survol. */
function Bars({ data, label }: { data: { key: string; tick: string; value: number; title: string }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);
  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      <div className="flex h-40 items-end gap-0.5 border-b border-border">
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 items-end justify-center" title={d.title}>
            {d === peak && d.value > 0 && (
              <span
                className="absolute text-[10px] text-muted-foreground"
                style={{ bottom: `calc(${(d.value / max) * 100}% + 2px)` }}
              >
                {d.value}
              </span>
            )}
            <div
              className="w-full max-w-6 rounded-t-[4px] bg-brand group-hover:opacity-80"
              style={{ height: d.value ? `${Math.max(2, (d.value / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-[10px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.key} className="flex-1 truncate text-center">
            {d.tick}
          </span>
        ))}
      </div>
    </figure>
  );
}

export default async function AccessPage({ searchParams }: PageProps<"/admin/acces">) {
  const ctx = await requireSpace("admin", "ACCESS_CONTROL");
  if (!can(ctx.role, "access.scan")) redirect("/admin");
  const wanted = (await searchParams).filtre;
  const filter = FILTERS.find((f) => f.value === wanted) ?? FILTERS[0];

  const { overview, logs } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    overview: await accessOverview(tx, ctx.tenant.id),
    logs: await listAccessLogs(tx, { granted: filter.granted, take: 100 }),
  }));
  const today = overview.days.at(-1)!;
  const average = Math.round(overview.days.reduce((sum, d) => sum + d.granted, 0) / overview.days.length);

  return (
    <>
      <PageHeader title="Fréquentation" description={`Contrôle d'accès — ${ctx.tenant.name}`}>
        <Link
          href="/reception/scan"
          className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground"
        >
          Ouvrir l&apos;écran de scan
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entrées aujourd'hui" value={today.granted} />
        <StatCard label="Adhérents venus aujourd'hui" value={today.members} />
        <StatCard label="Refus aujourd'hui" value={today.denied} />
        <StatCard label="Moyenne / jour" value={average} hint="sur les 14 derniers jours" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="par-jour">
          <h2 id="par-jour" className="mb-4 text-sm font-medium">
            Entrées par jour (14 jours)
          </h2>
          <Bars
            label="Entrées autorisées par jour"
            data={overview.days.map((d) => ({
              key: d.day,
              tick: dayLabel(d.day),
              value: d.granted,
              title: `${dayLabel(d.day)} : ${d.granted} entrée(s), ${d.members} adhérent(s), ${d.denied} refus`,
            }))}
          />
        </section>
        <section className="rounded-xl border bg-card p-5" aria-labelledby="par-heure">
          <h2 id="par-heure" className="mb-4 text-sm font-medium">
            Affluence d&apos;aujourd&apos;hui par heure
          </h2>
          <Bars
            label="Entrées autorisées par heure aujourd'hui"
            data={overview.hours.slice(5).map((h) => ({
              key: String(h.hour),
              tick: h.hour % 2 === 0 ? `${h.hour}h` : "",
              value: h.n,
              title: `${h.hour}h–${h.hour + 1}h : ${h.n} entrée(s)`,
            }))}
          />
        </section>
      </div>

      <details className="mb-6 rounded-xl border bg-card p-5 text-sm">
        <summary className="cursor-pointer font-medium">Tableau des 14 derniers jours</summary>
        <table className="mt-3 w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Jour</th>
              <th className="py-1 text-right font-normal">Entrées</th>
              <th className="py-1 text-right font-normal">Adhérents</th>
              <th className="py-1 text-right font-normal">Refus</th>
            </tr>
          </thead>
          <tbody>
            {overview.days.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-1">{dayLabel(d.day)}</td>
                <td className="py-1 text-right tabular-nums">{d.granted}</td>
                <td className="py-1 text-right tabular-nums">{d.members}</td>
                <td className="py-1 text-right tabular-nums">{d.denied}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {overview.reasons.length > 0 && (
        <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="motifs">
          <h2 id="motifs" className="mb-3 text-sm font-medium">
            Motifs de refus aujourd&apos;hui
          </h2>
          <ul className="space-y-1 text-sm">
            {overview.reasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-4">
                <span>{ACCESS_REASON_LABELS[r.reason]}</span>
                <span className="tabular-nums text-muted-foreground">{r.n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5" aria-labelledby="journal">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="journal" className="text-sm font-medium">
            Journal des passages
          </h2>
          <nav className="flex gap-1 text-sm" aria-label="Filtrer le journal">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === "tous" ? "/admin/acces" : `/admin/acces?filtre=${f.value}`}
                aria-current={f === filter ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1",
                  f === filter ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun passage enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-xl text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Adhérent</th>
                  <th className="py-2 font-normal">Résultat</th>
                  <th className="py-2 font-normal">Moyen</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2 whitespace-nowrap">{formatDateTime(l.occurredAt)}</td>
                    <td className="py-2">
                      {l.member ? (
                        <Link href={`/admin/adherents/${l.member.id}`} className="hover:underline">
                          {l.member.lastName} {l.member.firstName}{" "}
                          <span className="font-mono text-xs text-muted-foreground">{l.member.code}</span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Inconnu</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span
                        aria-hidden
                        className={cn("mr-1.5 inline-block size-2 rounded-full", l.granted ? "bg-emerald-500" : "bg-red-500")}
                      />
                      {l.granted
                        ? `Entrée${l.subscription ? ` · ${l.subscription.planName}` : ""}`
                        : ACCESS_REASON_LABELS[l.reason]}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {ACCESS_METHOD_LABELS[l.method]}
                      {l.offline && " · hors ligne"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
