import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { requireSpace } from "@/lib/session";
import { localParts } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { attendanceStats } from "@/modules/bookings/bookings.service";
import { listSessions, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Espace coach" };

const UPCOMING_DAYS = 14;

export default async function CoachHome() {
  const ctx = await requireSpace("coach");
  const now = new Date();

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    // Filtre sur la salle active : l'utilisateur voit aussi ses adhésions dans d'autres salles.
    const me = await tx.tenantMembership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
      select: { id: true, availability: true },
    });
    if (!me) return null;
    const { timezone } = await tenantToday(tx, ctx.tenant.id);
    const sessions = await listSessions(tx, now, new Date(now.getTime() + UPCOMING_DAYS * 86_400_000), {
      coachId: me.id,
    });
    const stats = await attendanceStats(tx, new Date(now.getTime() - 30 * 86_400_000), now, { coachId: me.id });
    return { sessions, timezone, hasAvailability: me.availability !== null, stats };
  });

  const timezone = data?.timezone ?? "Africa/Abidjan";
  const groups = new Map<string, NonNullable<typeof data>["sessions"]>();
  for (const s of data?.sessions ?? []) {
    const day = localParts(s.startsAt, timezone).date;
    groups.set(day, [...(groups.get(day) ?? []), s]);
  }
  const time = (d: Date) => localParts(d, timezone).time;

  return (
    <>
      <PageHeader title="Mes cours" description={`Espace coach — ${ctx.tenant.name}`}>
        <Link href="/coach/planning" className="text-sm text-brand hover:underline">
          Planning de la salle
        </Link>
      </PageHeader>

      {data && !data.hasAvailability && (
        <p className="mb-4 rounded-lg border border-dashed px-4 py-3 text-sm">
          Renseignez vos disponibilités dans{" "}
          <Link href="/coach/profil" className="text-brand underline">
            Mon profil
          </Link>{" "}
          : la salle ne pourra alors programmer vos cours que sur ces créneaux.
        </p>
      )}

      {data && data.stats.sessions > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          30 derniers jours : {data.stats.sessions} séance(s), remplissage {data.stats.fillRate ?? "—"} %, présence{" "}
          {data.stats.attendanceRate === null ? "non pointée" : `${data.stats.attendanceRate} %`}.
        </p>
      )}

      <section className="mb-6 flex flex-col gap-3" aria-labelledby="prochains">
        <h2 id="prochains" className="text-sm font-medium">
          Les {UPCOMING_DAYS} prochains jours
        </h2>
        {groups.size === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Aucun cours programmé.</p>
        ) : (
          [...groups].map(([day, sessions]) => (
            <article key={day} className="rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium">
                {DAY_NAMES[localParts(sessions[0].startsAt, timezone).weekday]} {day.split("-").reverse().join("/")}
              </h3>
              <ul className="space-y-2 text-sm">
                {sessions.map((s) => {
                  const cancelled = s.status === "CANCELLED";
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 border-l-4 pl-3",
                        cancelled && "opacity-60",
                      )}
                      style={{ borderLeftColor: s.classType.color }}
                    >
                      <Link
                        href={`/coach/seance/${s.id}`}
                        className={cn("font-medium hover:underline", cancelled && "line-through")}
                      >
                        {time(s.startsAt)}–{time(s.endsAt)} · {s.classType.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {s.room?.name ?? "Sans salle"} · {s.bookedCount}/{s.capacity} inscrits
                        {cancelled && <span className="ml-2 text-destructive">Annulée — {s.cancelReason}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))
        )}
      </section>

      <p className="text-xs text-muted-foreground">Ouvrez une séance pour voir ses inscrits et pointer les présences.</p>
    </>
  );
}
