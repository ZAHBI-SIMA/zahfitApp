import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { SeriesForm, StopSeriesForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { classOptions, getSeries, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Cours régulier" };

export default async function SeriesPage({ params }: PageProps<"/admin/planning/cours/[id]">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "classes.manage")) redirect("/admin/planning");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const series = await getSeries(tx, id);
    if (!series) return null;
    return {
      series,
      options: await classOptions(tx),
      today: (await tenantToday(tx, ctx.tenant.id)).today,
      upcoming: await tx.classSession.findMany({
        where: { seriesId: id, startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 10,
        select: { id: true, startsAt: true, status: true, isException: true },
      }),
    };
  });
  // Un identifiant d'une AUTRE salle renvoie null grâce au RLS : simple 404.
  if (!data) notFound();
  const { series, options, today, upcoming } = data;
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const typeName = options.types.find((t) => t.id === series.classTypeId)?.name ?? "Cours";

  return (
    <>
      <PageHeader title={`${typeName} — ${DAY_NAMES[series.weekday]} ${series.startTime}`} description="Cours régulier">
        <Link href="/admin/planning/cours" className="text-sm text-brand hover:underline">
          ← Cours réguliers
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="modifier">
          <h2 id="modifier" className="mb-1 text-sm font-medium">
            Modifier le cours
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Les séances à venir sont recalculées ; les séances déjà passées et celles modifiées une par une ne changent pas.
          </p>
          <SeriesForm
            options={options}
            today={today}
            series={{
              id: series.id,
              classTypeId: series.classTypeId,
              coachId: series.coachId,
              roomId: series.roomId,
              weekday: series.weekday,
              startTime: series.startTime,
              durationMinutes: series.durationMinutes,
              capacity: series.capacity,
              startsOn: isoDay(series.startsOn),
              endsOn: series.endsOn ? isoDay(series.endsOn) : null,
            }}
          />
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-xl border bg-card p-4 text-sm" aria-labelledby="prochaines">
            <h2 id="prochaines" className="mb-2 font-medium">
              Prochaines séances
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">Aucune séance à venir.</p>
            ) : (
              <ul className="space-y-1.5">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <Link href={`/admin/planning/seance/${s.id}`} className="hover:underline">
                      {formatDateTime(s.startsAt)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {s.status === "CANCELLED" ? "Annulée" : s.isException ? "Modifiée" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4" aria-labelledby="arreter">
            <h2 id="arreter" className="mb-2 text-sm font-medium">
              Arrêter le cours
            </h2>
            <StopSeriesForm seriesId={series.id} today={today} />
          </section>
        </aside>
      </div>
    </>
  );
}
