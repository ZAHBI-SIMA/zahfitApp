import type { Metadata } from "next";
import { PlanningView } from "@/components/classes/planning-view";
import { PageHeader } from "@/components/shell/page-header";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Planning" };

/** Planning complet de la salle, en lecture (le coach voit aussi les cours de ses collègues). */
export default async function CoachPlanningPage({ searchParams }: PageProps<"/coach/planning">) {
  const ctx = await requireSpace("coach", "CLASSES");
  return (
    <>
      <PageHeader title="Planning de la salle" description={ctx.tenant.name} />
      <PlanningView
        tenantId={ctx.tenant.id}
        userId={ctx.user.id}
        basePath="/coach/planning"
        searchParams={await searchParams}
        detailBase={null}
      />
    </>
  );
}
