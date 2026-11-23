import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffProfileForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { requireSpace } from "@/lib/session";
import { getStaffMember } from "@/modules/classes/classes.service";
import { readAvailability } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Mon profil" };

/** Le coach tient lui-même à jour ses spécialités et ses disponibilités. */
export default async function CoachProfilePage() {
  const ctx = await requireSpace("coach");
  const member = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    // Filtre sur la salle active : l'utilisateur voit aussi ses adhésions dans d'autres salles.
    const me = await tx.tenantMembership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    return me ? getStaffMember(tx, me.id) : null;
  });
  if (!member) notFound();

  return (
    <>
      <PageHeader title="Mon profil" description={`${member.user.name} — ${ctx.tenant.name}`} />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <StaffProfileForm
          membershipId={member.id}
          values={{
            phone: member.phone,
            bio: member.bio,
            specialties: member.specialties,
            availability: readAvailability(member.availability),
          }}
        />
      </div>
    </>
  );
}
