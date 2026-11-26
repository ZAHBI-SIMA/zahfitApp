import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { NewTicketForm } from "@/components/support/support-forms";
import { SupportAccessList, TicketPriorityBadge, TicketStatusBadge } from "@/components/support/ticket-views";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listSupportAccesses, listTenantTickets } from "@/modules/support/support.service";
import { TICKET_CATEGORY_LABELS, ticketRef } from "@/modules/support/support.rules";

export const metadata: Metadata = { title: "Support" };

export default async function TenantSupportPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "support.use")) redirect("/admin");
  const { tickets, accesses } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    tickets: await listTenantTickets(tx),
    accesses: await listSupportAccesses(tx, ctx.tenant.id),
  }));
  const waiting = tickets.filter((t) => t.status === "WAITING_CUSTOMER").length;

  return (
    <>
      <PageHeader
        title="Support ZahDigit"
        description="Posez vos questions, signalez un problème et suivez les réponses de l'équipe ZahDigit."
      />
      {waiting > 0 && (
        <p role="status" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {waiting} ticket(s) attendent votre réponse.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="tickets">
          <h2 id="tickets" className="mb-3 text-sm font-medium">
            Vos tickets
          </h2>
          {tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Aucun ticket pour le moment.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/admin/support/${t.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card p-3 hover:ring-2 hover:ring-brand/40"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{ticketRef(t.number)}</span>
                    <span className="flex-1 font-medium">{t.subject}</span>
                    <TicketPriorityBadge priority={t.priority} />
                    <TicketStatusBadge status={t.status} />
                    <span className="w-full text-xs text-muted-foreground">
                      {TICKET_CATEGORY_LABELS[t.category]} · dernière activité le {formatDateTime(t.lastActivityAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="nouveau" className="rounded-xl border bg-card p-5">
          <h2 id="nouveau" className="mb-4 text-sm font-medium">
            Nouveau ticket
          </h2>
          <NewTicketForm />
        </section>
      </div>

      <section aria-labelledby="acces" className="mt-8">
        <h2 id="acces" className="mb-1 text-sm font-medium">
          Accès du support à votre espace
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Pour diagnostiquer un problème, l&apos;équipe ZahDigit peut afficher votre espace tel que le voit un membre de
          votre équipe, en consultation seule (aucune modification possible), pour 2 heures au plus. Chaque accès est
          annoncé par e-mail aux administrateurs et conservé ici ; il ne peut être ni effacé ni modifié.
        </p>
        <SupportAccessList accesses={accesses} />
      </section>
    </>
  );
}
