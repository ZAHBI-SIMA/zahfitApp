import type { Metadata } from "next";
import { requireSpace } from "@/lib/session";
import { PageHeader, UpcomingList } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Réception" };

export default async function ReceptionHome() {
  const ctx = await requireSpace("reception");

  return (
    <>
      <PageHeader title="Accueil" description={`Réception — ${ctx.tenant.name}`} />
      <UpcomingList
        items={[
          { sprint: 4, label: "Encaisser un abonnement (espèces, Mobile Money)" },
          { sprint: 6, label: "Scanner les QR Codes à l'entrée" },
        ]}
      />
    </>
  );
}
