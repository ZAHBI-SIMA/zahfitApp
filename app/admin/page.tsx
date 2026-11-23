import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatCard, UpcomingList } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { dashboardStats } from "@/modules/subscriptions/subscriptions.service";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminHome() {
  const ctx = await requireSpace("admin");
  const stats = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => dashboardStats(tx, todayCalendar()));
  const canSeeSubscriptions = can(ctx.role, "subscriptions.read");
  const canSeeMoney = can(ctx.role, "finance.reports.read");

  return (
    <>
      <PageHeader title={ctx.tenant.name} description="Tableau de bord de l'établissement." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Adhérents actifs" value={stats.activeMembers} hint={`sur ${stats.members} inscrit(s)`} />
        {canSeeSubscriptions && (
          <>
            <Link href="/admin/abonnements?liste=a-renouveler" className="rounded-xl hover:ring-2 hover:ring-brand/40">
              <StatCard label="À renouveler (7 jours)" value={stats.toRenew} hint="Voir la liste →" />
            </Link>
            <Link href="/admin/abonnements?liste=expires" className="rounded-xl hover:ring-2 hover:ring-brand/40">
              <StatCard label="Expirés (30 jours)" value={stats.expired} hint="Non renouvelés →" />
            </Link>
            <Link href="/admin/abonnements?liste=en-attente" className="rounded-xl hover:ring-2 hover:ring-brand/40">
              <StatCard label="En attente de paiement" value={stats.pending} hint="À encaisser →" />
            </Link>
          </>
        )}
      </div>

      {canSeeMoney && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <StatCard label="Encaissé aujourd'hui" value={formatXof(stats.revenueToday)} hint="Paiements confirmés uniquement" />
          <StatCard label="Encaissé ce mois" value={formatXof(stats.revenueMonth)} hint="Paiements confirmés uniquement" />
        </div>
      )}

      <div className="mt-6">
        <UpcomingList
          items={[
            { sprint: 4, label: "Reçus PDF, paiement partiel, impayés, remboursements, export comptable" },
            { sprint: 5, label: "Paiement Mobile Money en ligne et statistiques détaillées" },
          ]}
        />
      </div>
    </>
  );
}
