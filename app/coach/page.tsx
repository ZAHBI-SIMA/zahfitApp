import type { Metadata } from "next";
import { requireSpace } from "@/lib/session";
import { PageHeader, UpcomingList } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Espace coach" };

export default async function CoachHome() {
  const ctx = await requireSpace("coach");

  return (
    <>
      <PageHeader title="Mes cours" description={`Espace coach — ${ctx.tenant.name}`} />
      <UpcomingList
        items={[
          { sprint: 7, label: "Planning de mes cours" },
          { sprint: 8, label: "Listes de participants et pointage des présences" },
        ]}
      />
    </>
  );
}
