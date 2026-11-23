import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanningView } from "@/components/classes/planning-view";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Planning" };

export default async function AdminPlanningPage({ searchParams }: PageProps<"/admin/planning">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "classes.read")) redirect("/admin");
  const canManage = can(ctx.role, "classes.manage");

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
