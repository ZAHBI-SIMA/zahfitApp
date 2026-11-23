import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanningView } from "@/components/classes/planning-view";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Planning" };

/** Planning en lecture : l'accueil renseigne les adhérents sur les cours du jour. */
export default async function ReceptionPlanningPage({ searchParams }: PageProps<"/reception/planning">) {
  const ctx = await requireSpace("reception");
  if (!can(ctx.role, "classes.read")) redirect("/reception");
  return (
    <>
      <PageHeader title="Planning des cours" description={ctx.tenant.name} />
      <PlanningView
        tenantId={ctx.tenant.id}
        userId={ctx.user.id}
        basePath="/reception/planning"
        searchParams={await searchParams}
        detailBase={can(ctx.role, "classes.manage") ? "/admin/planning/seance" : null}
      />
    </>
  );
}
