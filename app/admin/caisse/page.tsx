import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CashSettingsForm, ValidateCashForm } from "@/components/cash/cash-forms";
import { CashPanel } from "@/components/cash/cash-panel";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { currentCashView, listCashSessions, outsideSessionMovements } from "@/modules/cash/cash.service";
import { addDays, todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Caisse" };

const STATUS = {
  CLOSED: { label: "À valider", variant: "outline" },
  VALIDATED: { label: "Validée", variant: "secondary" },
  OPEN: { label: "Ouverte", variant: "default" },
} as const;

export default async function AdminCashPage() {
  const ctx = await requireSpace("admin");
  const canOperate = can(ctx.role, "cash.operate");
  const canManage = can(ctx.role, "cash.manage");
  const canReport = can(ctx.role, "finance.reports.read");
  if (!canOperate && !canReport) redirect("/admin");

  const since = addDays(todayCalendar(), -30);
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    view: await currentCashView(tx),
    sessions: await listCashSessions(tx, 30),
    outside: await outsideSessionMovements(tx, since),
    settings: await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { cashSessionRequired: true } }),
  }));
  const toValidate = data.sessions.filter((s) => s.status === "CLOSED");

  return (
    <>
      <PageHeader title="Caisse" description="Espèces : caisse du jour, clôtures à valider et historique.">
        {canReport && (
          <a
            href="/api/exports/caisse?periode=mois"
            download
            className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
          >
            Exporter les mouvements du mois (Excel / CSV)
          </a>
        )}
      </PageHeader>

      {data.outside.length > 0 && (
        <div role="alert" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">
            {data.outside.length} opération(s) en espèces sans caisse ouverte ces 30 derniers jours (
            {formatXof(data.outside.reduce((s, m) => s + m.amountXof, 0))}).
          </p>
          <p className="text-muted-foreground">
            Elles ne figurent dans aucun comptage. Pour l&apos;éviter, rendez l&apos;ouverture de la caisse obligatoire
            (réglage en bas de page).
          </p>
        </div>
      )}

      <section className="mb-8" aria-label="Caisse du jour">
        <CashPanel view={data.view} canOperate={canOperate} />
      </section>

      {canManage && toValidate.length > 0 && (
        <section className="mb-8" aria-labelledby="a-valider">
          <h2 id="a-valider" className="mb-2 text-sm font-medium">
            Clôtures à valider ({toValidate.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {toValidate.map((s) => (
              <div key={s.id} className="rounded-xl border bg-card p-4">
                <p className="text-sm">
                  Clôturée le {formatDateTime(s.closedAt!)} par {s.closedByName}
                </p>
                <p className="mt-1 text-sm">
                  Théorique {formatXof(s.expectedXof!)} · compté {formatXof(s.countedXof!)} ·{" "}
                  <strong className={cn(s.differenceXof !== 0 && "text-destructive")}>
                    écart {formatXof(s.differenceXof!)}
                  </strong>
                </p>
                {s.closingNote && <p className="mt-1 text-xs text-muted-foreground">« {s.closingNote} »</p>}
                <Link href={`/admin/caisse/${s.id}`} className="mb-3 inline-block text-xs text-brand hover:underline">
                  Voir le détail
                </Link>
                <ValidateCashForm sessionId={s.id} hasDifference={s.differenceXof !== 0} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8" aria-labelledby="historique">
        <h2 id="historique" className="mb-2 text-sm font-medium">
          Dernières caisses
        </h2>
        {data.sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucune caisse clôturée pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Ouverture</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Clôture</th>
                  <th className="px-4 py-3 text-right font-medium">Compté</th>
                  <th className="px-4 py-3 text-right font-medium">Écart</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDateTime(s.openedAt)}
                      <span className="block text-xs text-muted-foreground">{s.openedByName}</span>
                    </td>
                    <td className="hidden px-4 py-2 whitespace-nowrap lg:table-cell">
                      {s.closedAt ? formatDateTime(s.closedAt) : "—"}
                      <span className="block text-xs text-muted-foreground">{s.closedByName}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{formatXof(s.countedXof ?? 0)}</td>
                    <td className={cn("px-4 py-2 text-right whitespace-nowrap", s.differenceXof && "text-destructive")}>
                      {formatXof(s.differenceXof ?? 0)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/admin/caisse/${s.id}`} className="text-brand hover:underline">
                        Détail
                      </Link>
                      {" · "}
                      <a href={`/api/caisse/${s.id}`} target="_blank" rel="noopener" className="text-brand hover:underline">
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section className="max-w-4xl rounded-xl border bg-card p-5" aria-labelledby="reglage-caisse">
          <h2 id="reglage-caisse" className="mb-1 text-sm font-medium">
            Réglage
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Recommandé dès que l&apos;accueil a pris l&apos;habitude d&apos;ouvrir et de clôturer la caisse à chaque service.
            Les paiements Mobile Money ne sont pas concernés.
          </p>
          <CashSettingsForm cashSessionRequired={data.settings.cashSessionRequired} />
        </section>
      )}
    </>
  );
}
