import type { Metadata } from "next";
import { ROLE_LABELS } from "@/lib/labels";
import { requireSpace } from "@/lib/session";
import { PageHeader, StatCard, UpcomingList } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminHome() {
  const ctx = await requireSpace("admin");

  return (
    <>
      <PageHeader title={ctx.tenant.name} description="Tableau de bord de l'établissement." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Votre rôle" value={ROLE_LABELS[ctx.role]} />
        <StatCard
          label="Permissions"
          value={ctx.permissions.length}
          hint="Définies par la matrice des rôles"
        />
        <StatCard
          label="Double authentification"
          value={ctx.user.twoFactorEnabled ? "Activée" : "Désactivée"}
        />
      </div>
      <div className="mt-6">
        <UpcomingList
          items={[
            { sprint: 3, label: "Formules et cycle de vie des abonnements" },
            { sprint: 4, label: "Encaissements, reçus PDF, impayés" },
            { sprint: 5, label: "Paiement Mobile Money et tableau de bord chiffré" },
          ]}
        />
      </div>
    </>
  );
}
