import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClassTypeForm, RoomForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listClassTypes, listRooms, listSeries, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES, fromMinutes, toMinutes } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Cours réguliers" };

export default async function ClassesSetupPage({ searchParams }: PageProps<"/admin/planning/cours">) {
  const ctx = await requireSpace("admin", "CLASSES");
  if (!can(ctx.role, "classes.manage")) redirect("/admin/planning");
  const created = (await searchParams).cree;

  const { series, types, rooms, today } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    series: await listSeries(tx),
    types: await listClassTypes(tx),
    rooms: await listRooms(tx),
    today: (await tenantToday(tx, ctx.tenant.id)).today,
  }));
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const running = series.filter((s) => !s.endsOn || isoDay(s.endsOn) >= today);
  const stopped = series.filter((s) => s.endsOn && isoDay(s.endsOn) < today);

  return (
    <>
      <PageHeader title="Cours réguliers" description="Créneaux hebdomadaires, types de cours et salles de cours.">
        <Link href="/admin/planning" className="text-sm text-brand hover:underline">
          ← Planning
        </Link>
      </PageHeader>

      {typeof created === "string" && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Cours régulier créé : {created} séance(s) programmée(s) sur les 8 prochaines semaines.
        </p>
      )}

      <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="series">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="series" className="text-sm font-medium">
            Cours réguliers en cours
          </h2>
          {types.some((t) => t.isActive) ? (
            <Link
              href="/admin/planning/cours/nouveau"
              className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground"
            >
              Nouveau cours régulier
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">Ajoutez d&apos;abord un type de cours ci-dessous.</p>
          )}
        </div>
        {running.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun cours régulier.</p>
        ) : (
          <ul className="divide-y text-sm">
            {running.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/planning/cours/${s.id}`} className="flex items-center gap-2 hover:underline">
                  <span className="size-3 rounded-full" style={{ background: s.classType.color }} aria-hidden />
                  <span className="font-medium">{s.classType.name}</span>
                  <span className="text-muted-foreground">
                    {DAY_NAMES[s.weekday]} {s.startTime}–{fromMinutes(toMinutes(s.startTime) + s.durationMinutes)}
                  </span>
                </Link>
                <span className="text-muted-foreground">
                  {s.coach.user.name}
                  {s.room && ` · ${s.room.name}`} · {s.capacity} places
                  {s.endsOn && ` · jusqu'au ${formatDate(s.endsOn)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {stopped.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">{stopped.length} cours arrêté(s)</summary>
            <ul className="mt-2 space-y-1">
              {stopped.map((s) => (
                <li key={s.id}>
                  <Link href={`/admin/planning/cours/${s.id}`} className="hover:underline">
                    {s.classType.name} · {DAY_NAMES[s.weekday]} {s.startTime}
                  </Link>{" "}
                  <span className="text-muted-foreground">— arrêté le {formatDate(s.endsOn)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="types">
          <h2 id="types" className="mb-3 text-sm font-medium">
            Types de cours
          </h2>
          <div className="flex flex-col gap-4">
            {types.map((t) => (
              <div key={t.id} className="rounded-lg border p-3">
                {!t.isActive && (
                  <Badge variant="outline" className="mb-2">
                    Plus proposé
                  </Badge>
                )}
                <ClassTypeForm type={t} />
              </div>
            ))}
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Nouveau type</p>
              <ClassTypeForm />
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5" aria-labelledby="salles">
          <h2 id="salles" className="mb-1 text-sm font-medium">
            Salles de cours
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Facultatif. Une salle ne peut pas accueillir deux cours à la fois ; sa capacité plafonne les places.
          </p>
          <div className="flex flex-col gap-3">
            {rooms.map((r) => (
              <RoomForm key={r.id} room={r} />
            ))}
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Nouvelle salle de cours</p>
              <RoomForm />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
