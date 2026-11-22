import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withPlatform } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { TENANT_STATUS_LABELS } from "@/lib/labels";
import { requireSuperAdmin } from "@/lib/session";
import { listTenants } from "@/modules/tenants/tenants.service";

export const metadata: Metadata = { title: "Salles clientes" };

export default async function TenantsPage() {
  const user = await requireSuperAdmin();
  const tenants = await withPlatform(user.id, (tx) => listTenants(tx));

  return (
    <>
      <PageHeader title="Salles clientes" description={`${tenants.length} salle(s)`}>
        <Button nativeButton={false} render={<Link href="/super-admin/salles/nouveau" />}>
          Nouvelle salle
        </Button>
      </PageHeader>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Salle</th>
              <th className="px-4 py-3 font-medium">Localisation</th>
              <th className="px-4 py-3 font-medium">Adhérents</th>
              <th className="px-4 py-3 font-medium">Comptes</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Créée le</th>
              <th className="px-4 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3">
                  <Link href={`/super-admin/salles/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">/{t.slug}</p>
                </td>
                <td className="px-4 py-3">{[t.commune, t.city].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-3">{t._count.members}</td>
                <td className="px-4 py-3">{t._count.memberships}</td>
                <td className="hidden px-4 py-3 sm:table-cell">{formatDate(t.createdAt)}</td>
                <td className="px-4 py-3">
                  <Badge variant={t.status === "ACTIVE" ? "secondary" : "destructive"}>
                    {TENANT_STATUS_LABELS[t.status]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
