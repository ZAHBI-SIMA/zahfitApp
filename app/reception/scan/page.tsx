import type { Metadata } from "next";
import Link from "next/link";
import { AccessScanner } from "@/components/access/access-scanner";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { accessOverview } from "@/modules/access/access.service";

export const metadata: Metadata = { title: "Contrôle d'accès" };

export default async function ScanPage() {
  // L'espace Réception est réservé aux rôles qui ont `access.scan`.
  const ctx = await requireSpace("reception");
  const overview = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => accessOverview(tx, ctx.tenant.id, new Date(), 1));
  const today = overview.days.at(-1)!;

  return (
    <>
      <PageHeader title="Contrôle d'accès" description={`Entrée — ${ctx.tenant.name}`}>
        {can(ctx.role, "dashboard.view") && (
          <Link href="/admin/acces" className="text-sm text-brand hover:underline">
            Fréquentation et journal
          </Link>
        )}
      </PageHeader>
      <AccessScanner tenantId={ctx.tenant.id} initialCounts={{ granted: today.granted, denied: today.denied }} />
    </>
  );
}
