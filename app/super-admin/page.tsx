import type { Metadata } from "next";
import { withPlatform } from "@/lib/db";
import { TENANT_STATUS_LABELS } from "@/lib/labels";
import { requireSuperAdmin } from "@/lib/session";
import { PageHeader, StatCard, UpcomingList } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatXof } from "@/lib/format";
import { platformMessagingCosts } from "@/modules/messaging/messaging.service";

export const metadata: Metadata = { title: "Super Admin" };

export default async function SuperAdminHome() {
  const user = await requireSuperAdmin();

  const tenants = await withPlatform(user.id, (tx) =>
    tx.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        status: true,
        _count: { select: { memberships: true } },
      },
    }),
  );
  const active = tenants.filter((t) => t.status === "ACTIVE").length;
  const now = new Date();
  const costs = await platformMessagingCosts(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );

  return (
    <>
      <PageHeader title="Plateforme ZAHFIT" description="Vue globale des salles clientes." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Salles clientes" value={tenants.length} />
        <StatCard label="Salles actives" value={active} />
        <StatCard label="Salles suspendues" value={tenants.length - active} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Salle</th>
              <th className="px-4 py-3 font-medium">Ville</th>
              <th className="px-4 py-3 font-medium">Comptes</th>
              <th className="px-4 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">/{t.slug}</p>
                </td>
                <td className="px-4 py-3">{t.city ?? "—"}</td>
                <td className="px-4 py-3">{t._count.memberships}</td>
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

      <section className="mt-6" aria-labelledby="messagerie">
        <h2 id="messagerie" className="mb-2 text-sm font-medium">
          WhatsApp et SMS ce mois-ci
        </h2>
        {costs.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun message envoyé.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Salle</th>
                  <th className="px-4 py-3 text-right font-medium">WhatsApp</th>
                  <th className="px-4 py-3 text-right font-medium">SMS</th>
                  <th className="px-4 py-3 text-right font-medium">Coût</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.tenantId} className="border-b last:border-0">
                    <td className="px-4 py-2">{c.name}</td>
                    <td className="px-4 py-2 text-right">{c.whatsapp}</td>
                    <td className="px-4 py-2 text-right">{c.sms}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{formatXof(c.costXof)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6">
        <UpcomingList
          items={[
            { sprint: 12, label: "Forfaits SaaS et limites" },
          ]}
        />
      </div>
    </>
  );
}
