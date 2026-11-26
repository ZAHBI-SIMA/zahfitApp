import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { dashboardStats } from "@/modules/subscriptions/subscriptions.service";
import { onboardingState } from "@/modules/onboarding/onboarding.service";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const ctx = await requireSpace("admin");
  const owner = can(ctx.role, "staff.manage");
  const { stats, onboarding } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    stats: await dashboardStats(tx, todayCalendar()),
    onboarding: owner ? await onboardingState(tx, ctx.tenant.id) : null,
  }));
  const canSeeSubscriptions = can(ctx.role, "subscriptions.read");
  const canSeeMoney = can(ctx.role, "finance.reports.read");
  const justFinished = (await searchParams).demarrage === "termine";

  return (
    <>
      <PageHeader title={ctx.tenant.name} description="Tableau de bord de l'établissement." />

      {justFinished && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Votre salle est prête. Bonne saison avec ZAHFIT !
        </p>
      )}
      {onboarding && !onboarding.doneAt && (
        <Link
          href="/admin/demarrage"
          className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-brand/50 bg-brand/5 p-4 hover:ring-2 hover:ring-brand/40"
        >
          <div className="flex-1">
            <p className="font-medium">Mise en route de votre salle</p>
            <p className="text-sm text-muted-foreground">
              {onboarding.settled} étape(s) sur {onboarding.total} : infos, formules, adhérents, paiements, équipe.
            </p>
          </div>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-brand" style={{ width: `${(onboarding.settled / onboarding.total) * 100}%` }} />
          </div>
          <span className="text-sm font-medium text-brand">Continuer →</span>
        </Link>
      )}

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

    </>
  );
}
