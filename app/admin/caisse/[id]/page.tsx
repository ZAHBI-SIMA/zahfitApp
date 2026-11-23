import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { ValidateCashForm } from "@/components/cash/cash-forms";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CASH_MOVEMENT_LABELS, cashSessionReport } from "@/modules/cash/cash.service";

export const metadata: Metadata = { title: "Détail de caisse" };

const STATUS_LABELS = { OPEN: "Ouverte", CLOSED: "Clôturée, à valider", VALIDATED: "Validée" } as const;

export default async function CashSessionPage({ params }: PageProps<"/admin/caisse/[id]">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "finance.reports.read") && !can(ctx.role, "cash.manage")) redirect("/admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const report = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => cashSessionReport(tx, id));
  if (!report) notFound();
  const { session } = report;

  return (
    <>
      <PageHeader
        title={`Caisse du ${formatDateTime(session.openedAt)}`}
        description={`${STATUS_LABELS[session.status]} · ouverte par ${session.openedByName}`}
      >
        <Link href="/admin/caisse" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">
          Retour
        </Link>
        <a
          href={`/api/caisse/${session.id}`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
        >
          Z de caisse (PDF)
        </a>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Fond initial" value={formatXof(session.openingFloatXof)} />
        <StatCard label="Théorique" value={formatXof(session.expectedXof ?? report.balance)} />
        <StatCard label="Compté" value={session.countedXof === null ? "—" : formatXof(session.countedXof)} />
        <StatCard
          label="Écart"
          value={session.differenceXof === null ? "—" : formatXof(session.differenceXof)}
          hint={session.closingNote ?? undefined}
        />
      </div>

      <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
        <dt className="text-muted-foreground">Clôture</dt>
        <dd>{session.closedAt ? `${formatDateTime(session.closedAt)} — ${session.closedByName}` : "—"}</dd>
        <dt className="text-muted-foreground">Validation</dt>
        <dd>
          {session.validatedAt ? `${formatDateTime(session.validatedAt)} — ${session.validatedByName}` : "—"}
          {session.validationNote && <span className="block text-muted-foreground">« {session.validationNote} »</span>}
        </dd>
      </dl>

      {session.status === "CLOSED" && can(ctx.role, "cash.manage") && (
        <section className="mb-6 max-w-xl rounded-xl border bg-card p-5" aria-labelledby="valider">
          <h2 id="valider" className="mb-3 text-sm font-medium">
            Valider cette caisse
          </h2>
          <ValidateCashForm sessionId={session.id} hasDifference={session.differenceXof !== 0} />
        </section>
      )}

      <h2 className="mb-2 text-sm font-medium">Mouvements ({report.movements.length})</h2>
      {report.movements.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun mouvement.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Heure</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Libellé</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Par</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              {report.movements.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2">{CASH_MOVEMENT_LABELS[m.kind]}</td>
                  <td className="px-4 py-2">{m.label}</td>
                  <td className="hidden px-4 py-2 md:table-cell">{m.createdByName}</td>
                  <td className={cn("px-4 py-2 text-right whitespace-nowrap", m.amountXof < 0 && "text-destructive")}>
                    {m.amountXof > 0 ? "+" : "−"}
                    {formatXof(Math.abs(m.amountXof))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
