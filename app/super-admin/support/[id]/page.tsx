import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { PlatformReplyForm, PlatformTicketForm, StartSupportAccessForm } from "@/components/support/support-forms";
import { TicketPriorityBadge, TicketStatusBadge, TicketThread } from "@/components/support/ticket-views";
import { withPlatform } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";
import { requireSuperAdmin } from "@/lib/session";
import { SUPPORT_ACCESS_RULES, TICKET_CATEGORY_LABELS, ticketRef } from "@/modules/support/support.rules";
import { loadTicket } from "@/modules/support/support.service";

export const metadata: Metadata = { title: "Ticket de support" };

export default async function PlatformTicketPage({ params }: PageProps<"/super-admin/support/[id]">) {
  const user = await requireSuperAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withPlatform(user.id, async (tx) => {
    const ticket = await loadTicket(tx, id);
    if (!ticket) return null;
    const staff = await tx.tenantMembership.findMany({
      where: { tenantId: ticket.tenantId, status: "ACTIVE", role: { in: [...SUPPORT_ACCESS_RULES.allowedRoles] } },
      select: { role: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { ticket, staff };
  });
  if (!data) notFound();
  const { ticket, staff } = data;
  const closed = ticket.status === "CLOSED";

  return (
    <>
      <PageHeader
        title={`${ticketRef(ticket.number)} — ${ticket.subject}`}
        description={`${ticket.tenant.name} · ${TICKET_CATEGORY_LABELS[ticket.category]} · ouvert par ${ticket.createdByName} le ${formatDateTime(ticket.createdAt)}`}
      >
        <TicketPriorityBadge priority={ticket.priority} />
        <TicketStatusBadge status={ticket.status} />
      </PageHeader>
      <p className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/super-admin/support" className="text-brand hover:underline">
          ← File du support
        </Link>
        <Link href={`/super-admin/salles/${ticket.tenantId}`} className="text-brand hover:underline">
          Fiche de la salle
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <TicketThread messages={ticket.messages} viewer="platform" />
          {!closed && (
            <div className="mt-6 rounded-xl border bg-card p-5">
              <PlatformReplyForm ticketId={ticket.id} />
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-1 text-sm font-medium">Suivi</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {ticket.assignedToName ? `Suivi par ${ticket.assignedToName}` : "Non attribué"}
              {ticket.firstResponseAt && ` · 1re réponse le ${formatDateTime(ticket.firstResponseAt)}`}
            </p>
            {closed ? (
              <p className="text-sm text-muted-foreground">Ticket clos : historique figé.</p>
            ) : (
              <PlatformTicketForm
                // key : listes reconstruites après un changement (sinon elles gardent l'ancien statut).
                key={`${ticket.status}-${ticket.priority}-${ticket.assignedToId}`}
                ticketId={ticket.id}
                priority={ticket.priority}
                status={ticket.status}
                assignedToMe={ticket.assignedToId === user.id}
              />
            )}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-1 text-sm font-medium">Voir l&apos;espace de la salle</h2>
            <p className="mb-3 text-xs text-muted-foreground">Pour reproduire le problème signalé, en consultation seule.</p>
            <StartSupportAccessForm
              tenantId={ticket.tenantId}
              ticketId={ticket.id}
              staff={staff.map((s) => ({ userId: s.user.id, label: `${s.user.name} — ${ROLE_LABELS[s.role]}` }))}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
