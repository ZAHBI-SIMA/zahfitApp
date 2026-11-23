import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { ParticipantsPanel } from "@/components/bookings/participants-panel";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { localParts } from "@/lib/timezone";
import { getSession, tenantToday } from "@/modules/classes/classes.service";
import { DAY_NAMES, weekStart } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Séance" };

/** L'accueil inscrit ou retire un adhérent (téléphone, passage au comptoir). */
export default async function ReceptionSessionPage({ params }: PageProps<"/reception/planning/seance/[id]">) {
  const ctx = await requireSpace("reception");
  if (!can(ctx.role, "classes.read")) redirect("/reception");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const session = await getSession(tx, id);
    return session ? { session, timezone: (await tenantToday(tx, ctx.tenant.id)).timezone } : null;
  });
  // Un identifiant d'une AUTRE salle renvoie null grâce au RLS : simple 404.
  if (!data) notFound();
  const { session: s, timezone } = data;
  const start = localParts(s.startsAt, timezone);
  const end = localParts(s.endsAt, timezone);

  return (
    <>
      <PageHeader
        title={`${s.classType.name} — ${DAY_NAMES[start.weekday]} ${start.date.split("-").reverse().join("/")}`}
        description={`${start.time}–${end.time} · ${s.coach.user.name}${s.room ? ` · ${s.room.name}` : ""}`}
      >
        <Link href={`/reception/planning?semaine=${weekStart(start.date)}`} className="text-sm text-brand hover:underline">
          ← Planning
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
      </div>
    </>
  );
}
