import type { Metadata } from "next";
import { BookButton, CancelOwnButton } from "@/components/bookings/booking-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { requireSpace } from "@/lib/session";
import { localParts } from "@/lib/timezone";
import { bookableSessions, memberUpcomingBookings } from "@/modules/bookings/bookings.service";
import { DAY_NAMES } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Réservations" };

export default async function MemberBookingsPage() {
  const ctx = await requireSpace("member", "CLASSES");
  const now = new Date();
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    // Filtre sur la salle active : un compte peut être adhérent de plusieurs salles.
    const member = await tx.member.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!member) return null;
    return {
      bookable: await bookableSessions(tx, member.id, now),
      mine: await memberUpcomingBookings(tx, member.id, now),
    };
  });

  if (!data) {
    return (
      <>
        <PageHeader title="Réservations" />
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Votre compte n&apos;est pas encore relié à une fiche adhérent. Adressez-vous à l&apos;accueil.
        </p>
      </>
    );
  }

  const { sessions, settings } = data.bookable;
  const tz = settings.timezone;
  const day = (d: Date) => {
    const p = localParts(d, tz);
    return `${DAY_NAMES[p.weekday]} ${p.date.split("-").reverse().slice(0, 2).join("/")}`;
  };
  const time = (d: Date) => localParts(d, tz).time;
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) groups.set(day(s.startsAt), [...(groups.get(day(s.startsAt)) ?? []), s]);

  return (
    <>
      <PageHeader
        title="Réservations"
        description={`Réservez jusqu'à ${settings.bookingOpenDays} jours à l'avance ; annulation libre jusqu'à ${settings.bookingCancelHours} h avant le cours.`}
      />

      <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="mes-reservations">
        <h2 id="mes-reservations" className="mb-3 text-sm font-medium">
          Mes réservations
        </h2>
        {data.mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune réservation à venir.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="border-l-4 pl-3" style={{ borderLeftColor: b.session.classType.color }}>
                  <span className="font-medium">{b.session.classType.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {day(b.session.startsAt)} · {time(b.session.startsAt)}–{time(b.session.endsAt)}
                  </span>
                  {b.status === "WAITLISTED" && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Liste d&apos;attente
                    </span>
                  )}
                </span>
                <CancelOwnButton bookingId={b.id} waitlisted={b.status === "WAITLISTED"} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="disponibles">
        <h2 id="disponibles" className="text-sm font-medium">
          Séances des {settings.bookingOpenDays} prochains jours
        </h2>
        {groups.size === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Aucune séance programmée.</p>
        ) : (
          [...groups].map(([label, list]) => (
            <article key={label} className="rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium">{label}</h3>
              <ul className="divide-y text-sm">
                {list.map((s) => {
                  const mine = s.bookings[0];
                  const full = s.bookedCount >= s.capacity;
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span className="border-l-4 pl-3" style={{ borderLeftColor: s.classType.color }}>
                        <span className="font-medium">
                          {time(s.startsAt)}–{time(s.endsAt)} · {s.classType.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {s.coach.user.name}
                          {s.room && ` · ${s.room.name}`} ·{" "}
                          {full ? "complet" : `${s.capacity - s.bookedCount} place(s) restante(s)`}
                        </span>
                      </span>
                      {mine ? (
                        <span className="text-xs font-medium text-emerald-700">
                          {mine.status === "CONFIRMED" ? "Réservé ✓" : "En liste d'attente"}
                        </span>
                      ) : (
                        <BookButton sessionId={s.id} full={full} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))
        )}
      </section>
    </>
  );
}
