import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { StaffProfileForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { getStaffMember } from "@/modules/classes/classes.service";
import { readAvailability } from "@/modules/classes/schedule";

export const metadata: Metadata = { title: "Profil employé" };

export default async function StaffProfilePage({ params }: PageProps<"/admin/equipe/[id]">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "staff.manage")) redirect("/admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const member = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => getStaffMember(tx, id));
  // Un identifiant d'une AUTRE salle renvoie null grâce au RLS : simple 404.
  if (!member || member.role === "MEMBER") notFound();

  return (
    <>
      <PageHeader title={member.user.name} description={`${ROLE_LABELS[member.role]} · ${member.user.email}`}>
        <Link href="/admin/equipe" className="text-sm text-brand hover:underline">
          ← Équipe
        </Link>
      </PageHeader>
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
