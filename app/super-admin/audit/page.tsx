import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { withPlatform } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requireSuperAdmin } from "@/lib/session";
import { auditLabel, listAuditLogs } from "@/modules/audit/audit.service";

export const metadata: Metadata = { title: "Journal d'audit" };

export default async function AuditPage() {
  const user = await requireSuperAdmin();
  const logs = await withPlatform(user.id, (tx) => listAuditLogs(tx, 150));

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        description="150 dernières opérations sensibles, toutes salles confondues. Journal en ajout seul : non modifiable."
      />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Opération</th>
              <th className="px-4 py-3 font-medium">Salle</th>
              <th className="px-4 py-3 font-medium">Auteur</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Adresse IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(l.createdAt)}</td>
                <td className="px-4 py-2">{auditLabel(l.action)}</td>
                <td className="px-4 py-2">{l.tenant?.name ?? <span className="text-muted-foreground">Plateforme</span>}</td>
                <td className="px-4 py-2">{l.actor ? `${l.actor.name} (${l.actor.email})` : "Système"}</td>
                <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">{l.ipAddress ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
