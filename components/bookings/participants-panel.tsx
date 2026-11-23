import { AttendanceButtons, StaffBookForm, StaffCancelButton } from "@/components/bookings/booking-forms";
import { withTenant } from "@/lib/db";
import { sessionParticipants } from "@/modules/bookings/bookings.service";

/**
 * Participants d'une séance (admin, accueil, coach). Ce que chacun peut
 * faire dépend de ses droits : inscrire / retirer (bookings.manage),
 * pointer (attendance.write). Seuls le nom et le code sont affichés.
 */
export async function ParticipantsPanel({
  tenantId,
  userId,
  session,
  canBook,
  canMark,
}: {
  tenantId: string;
  userId: string;
  session: { id: string; capacity: number; bookedCount: number; status: "SCHEDULED" | "CANCELLED"; startsAt: Date };
  canBook: boolean;
  canMark: boolean;
}) {
  const participants = await withTenant(tenantId, userId, (tx) => sessionParticipants(tx, session.id));
  const confirmed = participants.filter((p) => p.status === "CONFIRMED");
  const waitlist = participants.filter((p) => p.status === "WAITLISTED");
  const present = confirmed.filter((p) => p.attendance === "PRESENT").length;
  const upcoming = session.startsAt > new Date();
  const open = session.status === "SCHEDULED";

  return (
    <section className="rounded-xl border bg-card p-4 text-sm" aria-labelledby="participants">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="participants" className="font-medium">
          Participants
        </h2>
        <span className="text-muted-foreground">
          {session.bookedCount}/{session.capacity} places
          {waitlist.length > 0 && ` · ${waitlist.length} en attente`}
          {canMark && confirmed.length > 0 && ` · ${present} présent(s)`}
        </span>
      </div>

      {confirmed.length === 0 ? (
        <p className="text-muted-foreground">Aucune réservation.</p>
      ) : (
        <ol className="divide-y">
          {confirmed.map((p, i) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                {p.member.lastName} {p.member.firstName}{" "}
                <span className="font-mono text-xs text-muted-foreground">{p.member.code}</span>
                {p.promotedAt && <span className="ml-1 text-xs text-muted-foreground">(liste d&apos;attente)</span>}
              </span>
              <span className="flex items-center gap-1">
                {canMark && open && <AttendanceButtons bookingId={p.id} attendance={p.attendance} />}
                {canBook && open && upcoming && <StaffCancelButton bookingId={p.id} />}
              </span>
            </li>
          ))}
        </ol>
      )}

      {waitlist.length > 0 && (
        <>
          <h3 className="mt-4 mb-1 text-xs font-medium text-muted-foreground">Liste d&apos;attente</h3>
          <ol className="divide-y">
            {waitlist.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>
                  <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                  {p.member.lastName} {p.member.firstName}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{p.member.code}</span>
                </span>
                {canBook && open && upcoming && <StaffCancelButton bookingId={p.id} />}
              </li>
            ))}
          </ol>
        </>
      )}

      {canBook && open && upcoming && (
        <div className="mt-4 border-t pt-3">
          <StaffBookForm sessionId={session.id} />
        </div>
      )}
    </section>
  );
}
