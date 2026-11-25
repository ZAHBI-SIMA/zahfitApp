import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { ParticipantsPanel } from "@/components/bookings/participants-panel";
import { CancelSessionForm, RestoreSessionForm, SessionEditForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { localParts } from "@/lib/timezone";
import { classOptions, getSession, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES, weekStart } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Séance" };

export default async function SessionPage({ params, searchParams }: PageProps<"/admin/planning/seance/[id]">) {
  const ctx = await requireSpace("admin", "CLASSES");
  if (!can(ctx.role, "classes.manage")) redirect("/admin/planning");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const created = (await searchParams).cree === "1";

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const session = await getSession(tx, id);
    if (!session) return null;
    return { session, options: await classOptions(tx), timezone: (await tenantToday(tx, ctx.tenant.id)).timezone };
  });
  // Un identifiant d'une AUTRE salle renvoie null grâce au RLS : simple 404.
  if (!data) notFound();
  const { session: s, options, timezone } = data;
  const start = localParts(s.startsAt, timezone);
  const end = localParts(s.endsAt, timezone);
  const cancelled = s.status === "CANCELLED";
  const durationMinutes = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);

  return (
    <>
      <PageHeader
        title={`${s.classType.name} — ${DAY_NAMES[start.weekday]} ${start.date.split("-").reverse().join("/")}`}
        description={`${start.time}–${end.time} · ${s.coach.user.name}${s.room ? ` · ${s.room.name}` : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {cancelled && <Badge variant="destructive">Annulée</Badge>}
          {s.isException && !cancelled && <Badge variant="secondary">Modifiée</Badge>}
          {!s.series && <Badge variant="outline">Ponctuelle</Badge>}
          <Link href={`/admin/planning?semaine=${weekStart(start.date)}`} className="text-sm text-brand hover:underline">
            ← Planning
          </Link>
        </div>
      </PageHeader>

      {created && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Séance ajoutée au planning.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="modifier">
          <h2 id="modifier" className="mb-1 text-sm font-medium">
            Modifier cette séance uniquement
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Remplacement de coach, changement d&apos;horaire ou de salle pour ce jour-là.
            {s.series && " Le cours régulier ne réécrira plus cette séance."}
          </p>
          {cancelled ? (
            <p className="text-sm text-muted-foreground">Rétablissez la séance pour la modifier.</p>
          ) : (
            <SessionEditForm
              options={options}
              session={{
                id: s.id,
                date: start.date,
                coachId: s.coach.id,
                roomId: s.roomId,
                startTime: start.time,
                durationMinutes,
                capacity: s.capacity,
                notes: s.notes,
              }}
            />
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-xl border bg-card p-4 text-sm" aria-labelledby="statut">
            <h2 id="statut" className="mb-2 font-medium">
              {cancelled ? "Séance annulée" : "Annuler la séance"}
            </h2>
            {cancelled ? (
              <>
                <p className="mb-3 text-muted-foreground">Motif : {s.cancelReason}</p>
                <RestoreSessionForm sessionId={s.id} />
              </>
            ) : (
              <CancelSessionForm sessionId={s.id} />
            )}
          </section>
          {s.series && (
            <Link href={`/admin/planning/cours/${s.series.id}`} className="text-sm text-brand hover:underline">
              Voir le cours régulier ({DAY_NAMES[s.series.weekday]} {s.series.startTime})
            </Link>
          )}
          <ParticipantsPanel
            tenantId={ctx.tenant.id}
            userId={ctx.user.id}
            session={s}
            canBook={can(ctx.role, "bookings.manage")}
            canMark={can(ctx.role, "attendance.write")}
          />
        </aside>
      </div>
    </>
  );
}
