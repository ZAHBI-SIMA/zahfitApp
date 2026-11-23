import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { ParticipantsPanel } from "@/components/bookings/participants-panel";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { localParts } from "@/lib/timezone";
import { getSession, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Séance" };

/** Liste des participants et pointage, pour le coach de la séance. */
export default async function CoachSessionPage({ params }: PageProps<"/coach/seance/[id]">) {
  const ctx = await requireSpace("coach");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const session = await getSession(tx, id);
    if (!session) return null;
    const coach = await tx.tenantMembership.findUnique({ where: { id: session.coach.id }, select: { userId: true } });
    return {
      session,
      ownSession: coach?.userId === ctx.user.id,
      timezone: (await tenantToday(tx, ctx.tenant.id)).timezone,
    };
  });
  // Autre salle (RLS) ou séance d'un collègue : un coach ne voit que ses propres listes.
  if (!data || (!data.ownSession && !can(ctx.role, "classes.manage"))) notFound();
  const { session: s, timezone } = data;
  const start = localParts(s.startsAt, timezone);
  const end = localParts(s.endsAt, timezone);

  return (
    <>
      <PageHeader
        title={`${s.classType.name} — ${DAY_NAMES[start.weekday]} ${start.date.split("-").reverse().join("/")}`}
        description={`${start.time}–${end.time}${s.room ? ` · ${s.room.name}` : ""}`}
      >
        <Link href="/coach" className="text-sm text-brand hover:underline">
          ← Mes cours
        </Link>
      </PageHeader>
      {s.status === "CANCELLED" && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">Séance annulée — {s.cancelReason}</p>
      )}
      <div className="max-w-2xl">
        <ParticipantsPanel
          tenantId={ctx.tenant.id}
          userId={ctx.user.id}
          session={s}
          canBook={can(ctx.role, "bookings.manage")}
          canMark={can(ctx.role, "attendance.write")}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Le pointage s&apos;ouvre 30 minutes avant la séance et reste possible 7 jours.
        </p>
      </div>
    </>
  );
}
