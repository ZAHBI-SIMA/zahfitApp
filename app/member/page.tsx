import type { Metadata } from "next";
import { requireSpace } from "@/lib/session";
import { PageHeader, UpcomingList } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Mon espace" };

export default async function MemberHome() {
  const ctx = await requireSpace("member");

  return (
    <>
      <PageHeader
        title={`Bonjour ${ctx.user.name.split(" ")[0]}`}
        description={`Votre espace adhérent — ${ctx.tenant.name}`}
      />
      <UpcomingList
        items={[
          { sprint: 3, label: "Consulter mon abonnement" },
          { sprint: 5, label: "Payer et renouveler en ligne, télécharger mes reçus" },
          { sprint: 6, label: "Présenter mon QR Code à l'entrée" },
          { sprint: 8, label: "Réserver un cours" },
        ]}
      />
    </>
  );
}
