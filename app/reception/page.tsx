import type { Metadata } from "next";
import Link from "next/link";
import { requireSpace } from "@/lib/session";
import { PageHeader, UpcomingList } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Réception" };

export default async function ReceptionHome() {
  const ctx = await requireSpace("reception");

  return (
    <>
      <PageHeader title="Accueil" description={`Réception — ${ctx.tenant.name}`} />
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href="/reception/scan" className="inline-flex h-10 items-center rounded-lg bg-brand px-5 font-medium text-brand-foreground">
          Contrôle d&apos;accès
        </Link>
        <Link href="/reception/encaisser" className="inline-flex h-10 items-center rounded-lg border px-5 font-medium hover:bg-muted">
          Encaisser
        </Link>
      </div>
      <UpcomingList items={[{ sprint: 7, label: "Planning des cours" }, { sprint: 8, label: "Réservations et présences" }]} />
    </>
  );
}
