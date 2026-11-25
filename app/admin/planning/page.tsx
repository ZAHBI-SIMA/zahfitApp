import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanningView } from "@/components/classes/planning-view";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { attendanceStats } from "@/modules/bookings/bookings.service";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Planning" };

export default async function AdminPlanningPage({ searchParams }: PageProps<"/admin/planning">) {
  const ctx = await requireSpace("admin", "CLASSES");
  if (!can(ctx.role, "classes.read")) redirect("/admin");
  const canManage = can(ctx.role, "classes.manage");
  const now = new Date();
  const stats = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
    attendanceStats(tx, new Date(now.getTime() - 30 * 86_400_000), now),
  );

  return (
    <>
      <PageHeader title="Planning des cours" description={ctx.tenant.name}>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/planning/cours"
              className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
            >
              Cours réguliers, types et salles
            </Link>
            <Link
              href="/admin/planning/seance/nouvelle"
              className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground"
            >
              Séance ponctuelle
            </Link>
          </div>
        )}
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Séances (30 jours)" value={stats.sessions} />
        <StatCard
          label="Taux de remplissage"
          value={stats.fillRate === null ? "—" : `${stats.fillRate} %`}
          hint="places réservées / capacité"
        />
        <StatCard
          label="Taux de présence"
          value={stats.attendanceRate === null ? "—" : `${stats.attendanceRate} %`}
          hint="présents / places pointées"
        />
      </div>
      <PlanningView
        tenantId={ctx.tenant.id}
        userId={ctx.user.id}
        basePath="/admin/planning"
        searchParams={await searchParams}
        detailBase={canManage ? "/admin/planning/seance" : null}
      />
    </>
  );
}
