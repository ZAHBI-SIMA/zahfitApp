import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { InviteStaffForm, StaffRowActions } from "@/components/staff/staff-forms";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";
import { can, requiresTwoFactor } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listStaff } from "@/modules/staff/staff.service";

export const metadata: Metadata = { title: "Équipe" };

export default async function StaffPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "staff.manage")) redirect("/admin");
  const staff = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => listStaff(tx, ctx.tenant.id));

  return (
    <>
      <PageHeader title="Équipe" description="Comptes du personnel de la salle et leurs rôles." />

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Membre</th>
              <th className="px-4 py-3 font-medium">Rôle</th>
              <th className="px-4 py-3 font-medium">Sécurité</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b align-top last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{s.user.name}</p>
                  <p className="text-xs text-muted-foreground">{s.user.email}</p>
                </td>
                <td className="px-4 py-3">
                  {ROLE_LABELS[s.role]}
                  {s.status === "DISABLED" && (
                    <Badge variant="outline" className="ml-2">
                      Désactivé
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {s.user.twoFactorEnabled ? (
                    <Badge variant="secondary">2FA activée</Badge>
                  ) : requiresTwoFactor(s.role) ? (
                    <Badge variant="destructive">2FA à activer</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StaffRowActions
                    membershipId={s.id}
                    role={s.role}
                    status={s.status}
                    isSelf={s.user.id === ctx.user.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6 rounded-xl border bg-card p-5" aria-labelledby="inviter">
        <h2 id="inviter" className="mb-1 text-sm font-medium">
          Inviter un membre de l&apos;équipe
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          La personne reçoit un e-mail pour choisir elle-même son mot de passe. Aucun mot de passe ne
          transite par vous.
        </p>
        <InviteStaffForm />
      </section>
    </>
  );
}
