import Link from "next/link";
import { withTenant } from "@/lib/db";
import { localParts, zonedToUtc } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { listSessions, tenantToday, type PlanningSession } from "@/modules/classes/classes.service";
import { DAY_NAMES, addDaysIso, weekStart, weekdayOf } from "@/modules/classes/schedule";

/**
 * Vue planning partagée (Administration, Réception, coach). Semaine
 * (7 colonnes, empilées sur mobile) ou jour, navigation par URL
 * (?semaine=AAAA-MM-JJ / ?jour=AAAA-MM-JJ) : un lien suffit pour partager une vue.
 */

type SearchParams = Record<string, string | string[] | undefined>;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const param = (v: string | string[] | undefined) => (typeof v === "string" && ISO_RE.test(v) ? v : null);

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

const navLink = "rounded-md border px-2.5 py-1 hover:bg-muted";
const tab = (active: boolean) =>
  cn("rounded-md px-2.5 py-1", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted");

export async function PlanningView({
  tenantId,
  userId,
  basePath,
  searchParams,
  detailBase,
  coachId,
}: {
  tenantId: string;
  userId: string;
  /** Page qui affiche la vue (liens de navigation) */
  basePath: string;
  searchParams: SearchParams;
  /** Lien vers le détail d'une séance (null = lecture seule) */
  detailBase: string | null;
  /** Restreint aux séances d'un coach */
  coachId?: string;
}) {
  const jour = param(searchParams.jour);
  const { today, timezone, sessions, start, days } = await withTenant(tenantId, userId, async (tx) => {
    const { today, timezone } = await tenantToday(tx, tenantId);
    const start = jour ?? weekStart(param(searchParams.semaine) ?? today);
    const days = jour ? 1 : 7;
    const sessions = await listSessions(
      tx,
      zonedToUtc(start, "00:00", timezone),
      zonedToUtc(addDaysIso(start, days), "00:00", timezone),
      { coachId },
    );
    return { today, timezone, sessions, start, days };
  });

  const dates = Array.from({ length: days }, (_, i) => addDaysIso(start, i));
  const byDay = new Map<string, PlanningSession[]>(dates.map((d) => [d, []]));
  for (const s of sessions) byDay.get(localParts(s.startsAt, timezone).date)?.push(s);

  const time = (d: Date) => localParts(d, timezone).time;
  const prev = jour ? `?jour=${addDaysIso(start, -1)}` : `?semaine=${addDaysIso(start, -7)}`;
  const next = jour ? `?jour=${addDaysIso(start, 1)}` : `?semaine=${addDaysIso(start, 7)}`;
  const title = jour ? dayLabel(start) : `Semaine du ${dayLabel(start)} au ${dayLabel(addDaysIso(start, 6))}`;

  return (
    <section aria-labelledby="planning-titre" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="planning-titre" className="text-sm font-medium first-letter:uppercase">
          {title}
        </h2>
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Naviguer dans le planning">
          <Link href={`${basePath}${prev}`} className={navLink} aria-label="Période précédente">
            ←
          </Link>
          <Link href={jour ? `${basePath}?jour=${today}` : basePath} className={navLink}>
            Aujourd&apos;hui
          </Link>
          <Link href={`${basePath}${next}`} className={navLink} aria-label="Période suivante">
            →
          </Link>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Link href={`${basePath}?semaine=${weekStart(start)}`} aria-current={!jour ? "page" : undefined} className={tab(!jour)}>
            Semaine
          </Link>
          <Link
            href={`${basePath}?jour=${jour ?? (dates.includes(today) ? today : start)}`}
            aria-current={jour ? "page" : undefined}
            className={tab(!!jour)}
          >
            Jour
          </Link>
        </nav>
      </div>

      <div className={cn("grid gap-3", !jour && "lg:grid-cols-7")}>
        {dates.map((date) => {
          const list = byDay.get(date) ?? [];
          return (
            <div
              key={date}
              className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3", date === today && "border-brand")}
            >
              <Link
                href={`${basePath}?jour=${date}`}
                className={cn("text-xs font-medium first-letter:uppercase hover:underline", date === today && "text-brand")}
              >
                {jour ? dayLabel(date) : `${DAY_NAMES[weekdayOf(date)].slice(0, 3)} ${Number(date.slice(8))}`}
              </Link>
              {list.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                list.map((s) => {
                  const cancelled = s.status === "CANCELLED";
                  const card = (
                    <div
                      className={cn(
                        "rounded-lg border-l-4 bg-muted/40 px-2.5 py-2 text-xs",
                        cancelled && "opacity-60",
                        detailBase && "hover:bg-muted",
                      )}
                      style={{ borderLeftColor: s.classType.color }}
                    >
                      <p className={cn("font-medium", cancelled && "line-through")}>
                        {time(s.startsAt)}–{time(s.endsAt)} · {s.classType.name}
                      </p>
                      <p className="text-muted-foreground">
                        {s.coach.user.name}
                        {s.room && ` · ${s.room.name}`}
                        {` · ${s.bookedCount}/${s.capacity} réservées`}
                      </p>
                      {cancelled && <p className="font-medium text-destructive">Annulée — {s.cancelReason}</p>}
                      {!cancelled && s.isException && <p className="text-muted-foreground">Modifiée</p>}
                      {jour && s.notes && <p className="mt-1">{s.notes}</p>}
                    </div>
                  );
                  return detailBase ? (
                    <Link key={s.id} href={`${detailBase}/${s.id}`} className="block">
                      {card}
                    </Link>
                  ) : (
                    <div key={s.id}>{card}</div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
