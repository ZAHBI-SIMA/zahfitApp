import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { CloseTicketButton, TenantReplyForm } from "@/components/support/support-forms";
import { TicketPriorityBadge, TicketStatusBadge, TicketThread } from "@/components/support/ticket-views";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { TICKET_CATEGORY_LABELS, ticketRef } from "@/modules/support/support.rules";
import { loadTicket } from "@/modules/support/support.service";

export const metadata: Metadata = { title: "Ticket de support" };

export default async function TenantTicketPage({ params, searchParams }: PageProps<"/admin/support/[id]">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "support.use")) redirect("/admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const created = (await searchParams).cree === "1";
  // Contexte de la salle : un ticket d'une autre salle est invisible (RLS) → 404.
  const ticket = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => loadTicket(tx, id));
  if (!ticket) notFound();
  const closed = ticket.status === "CLOSED";

  return (
    <>
      <PageHeader
        title={`${ticketRef(ticket.number)} — ${ticket.subject}`}
        description={`${TICKET_CATEGORY_LABELS[ticket.category]} · ouvert par ${ticket.createdByName} le ${formatDateTime(ticket.createdAt)}`}
      >
        <TicketPriorityBadge priority={ticket.priority} />
        <TicketStatusBadge status={ticket.status} />
      </PageHeader>
      <p className="mb-4 text-sm">
        <Link href="/admin/support" className="text-brand hover:underline">
          ← Tous les tickets
        </Link>
      </p>
      {created && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Ticket envoyé. L&apos;équipe ZahDigit vous répond ici et par e-mail.
        </p>
      )}

      <div className="max-w-3xl">
        <TicketThread messages={ticket.messages} viewer="tenant" />
        {closed ? (
          <p className="mt-6 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Ticket clos le {ticket.closedAt ? formatDateTime(ticket.closedAt) : "—"}. Pour une nouvelle demande, ouvrez un
            nouveau ticket.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-4 rounded-xl border bg-card p-5">
            <TenantReplyForm ticketId={ticket.id} />
            <div className="border-t pt-4">
              <p className="mb-2 text-xs text-muted-foreground">Problème réglé ou demande sans objet ?</p>
              <CloseTicketButton ticketId={ticket.id} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
