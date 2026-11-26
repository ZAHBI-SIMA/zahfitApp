import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/support/ticket-views";
import { withPlatform } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requireSuperAdmin } from "@/lib/session";
import { cn } from "@/lib/utils";
import { TICKET_CATEGORY_LABELS, ticketRef, type PlatformTicketFilter } from "@/modules/support/support.rules";
import { listPlatformTickets, supportKpis } from "@/modules/support/support.service";

export const metadata: Metadata = { title: "Support" };

const FILTERS: Record<PlatformTicketFilter, string> = {
  "a-traiter": "À traiter",
  "en-attente": "En attente de la salle",
  resolus: "Résolus et clos",
  tous: "Tous",
};

export default async function PlatformSupportPage({ searchParams }: PageProps<"/super-admin/support">) {
  const user = await requireSuperAdmin();
  const wanted = (await searchParams).filtre;
  const filter: PlatformTicketFilter =
    typeof wanted === "string" && wanted in FILTERS ? (wanted as PlatformTicketFilter) : "a-traiter";
  const { tickets, kpi } = await withPlatform(user.id, async (tx) => ({
    tickets: await listPlatformTickets(tx, filter),
    kpi: await supportKpis(tx),
  }));

  return (
    <>
      <PageHeader title="Support des salles" description="Tickets des salles clientes, du plus urgent au plus ancien." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="À traiter" value={kpi.toHandle} hint={kpi.urgent ? `dont ${kpi.urgent} urgent(s)` : undefined} />
        <StatCard label="En attente des salles" value={kpi.waiting} />
        <StatCard
          label="Première réponse (30 j)"
          value={kpi.firstResponseHours === null ? "—" : `${kpi.firstResponseHours} h`}
          hint="Délai moyen"
        />
      </div>

      <nav aria-label="Filtre" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(FILTERS) as PlatformTicketFilter[]).map((f) => (
          <Link
            key={f}
            href={`/super-admin/support?filtre=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", f === filter ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {FILTERS[f]}
          </Link>
        ))}
      </nav>

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Aucun ticket.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/super-admin/support/${t.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card p-3 hover:ring-2 hover:ring-brand/40"
              >
                <span className="font-mono text-xs text-muted-foreground">{ticketRef(t.number)}</span>
                <span className="flex-1 font-medium">
                  {t.tenant.name} — {t.subject}
                </span>
                <TicketPriorityBadge priority={t.priority} />
                <TicketStatusBadge status={t.status} />
                <span className="w-full text-xs text-muted-foreground">
                  {TICKET_CATEGORY_LABELS[t.category]} · {t.assignedToName ? `suivi par ${t.assignedToName}` : "non attribué"}{" "}
                  · dernière activité le {formatDateTime(t.lastActivityAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
