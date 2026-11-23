import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AttachmentForm,
  CategoryForm,
  ExpenseForm,
  RemoveAttachmentButton,
  ToggleCategoryButton,
  VoidExpenseForm,
} from "@/components/expenses/expense-forms";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listCategories, listExpenses } from "@/modules/expenses/expenses.service";
import { PERIODS, listPayments, parsePeriod, periodRange, type Period } from "@/modules/payments/payments.service";
import { isoDate, todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Dépenses" };

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

export default async function ExpensesPage({ searchParams }: PageProps<"/admin/depenses">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "expenses.manage")) redirect("/admin");
  const period = parsePeriod((await searchParams).periode);
  const today = todayCalendar();
  const range = periodRange(period, today);
  const canReport = can(ctx.role, "finance.reports.read");

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    categories: await listCategories(tx, ctx.tenant.id),
    expenses: await listExpenses(tx, range),
    // Recettes de la même période : le résultat se lit au même endroit.
    income: canReport ? (await listPayments(tx, range)).totals.net : null,
  }));
  const { rows, totals } = data.expenses;
  const recorded = rows.filter((r) => r.status === "RECORDED").length;

  return (
    <>
      <PageHeader title="Dépenses" description="Charges de la salle, justificatifs et résultat de la période.">
        {canReport && (
          <a
            href={`/api/exports/depenses?periode=${period}`}
            download
            className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
          >
            Exporter (Excel / CSV)
          </a>
        )}
      </PageHeader>

      <nav aria-label="Période" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <Link
            key={p}
            href={`/admin/depenses?periode=${p}`}
            aria-current={p === period ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", p === period ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {PERIODS[p]}
          </Link>
        ))}
      </nav>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Dépenses" value={formatXof(totals.total)} hint={`${recorded} opération(s)`} />
        {data.income !== null && (
          <>
            <StatCard label="Recettes nettes" value={formatXof(data.income)} hint="Encaissements − remboursements" />
            <StatCard
              label="Résultat"
              value={formatXof(data.income - totals.total)}
              hint={data.income - totals.total >= 0 ? "Excédent" : "Déficit"}
            />
          </>
        )}
      </div>
      {totals.byCategory.length > 0 && (
        <p className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {totals.byCategory.map((c) => (
            <span key={c.name}>
              {c.name} : <strong className="text-foreground">{formatXof(c.amountXof)}</strong>
            </span>
          ))}
        </p>
      )}

      <section className="mb-8 rounded-xl border bg-card p-5" aria-labelledby="nouvelle-depense">
        <h2 id="nouvelle-depense" className="mb-1 text-sm font-medium">
          Nouvelle dépense
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Payée en espèces, elle sort automatiquement de la caisse ouverte. Photographiez la facture avec le téléphone pour
          la joindre.
        </p>
        <ExpenseForm categories={data.categories.filter((c) => c.isActive)} today={isoDate(today)} />
      </section>

      <h2 className="mb-2 text-sm font-medium">Journal ({rows.length})</h2>
      {rows.length === 0 ? (
        <div className="mb-8 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucune dépense sur cette période.
        </div>
      ) : (
        <ul className="mb-8 flex flex-col gap-3">
          {rows.map((e) => {
            const voided = e.status === "VOIDED";
            return (
              <li key={e.id} className={cn("rounded-xl border bg-card p-4", voided && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={cn("font-medium", voided && "line-through")}>{e.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(e.spentOn)} · {e.category.name} · {PAYMENT_METHOD_LABELS[e.method]}
                      {e.supplier && <> · {e.supplier}</>}
                      {e.reference && <> · n° {e.reference}</>} · saisie par {e.recordedByName}
                    </p>
                    {e.note && <p className="mt-1 text-xs">{e.note}</p>}
                    {voided && <p className="mt-1 text-xs text-destructive">Annulée : {e.voidReason}</p>}
                  </div>
                  <p className={cn("text-lg font-semibold whitespace-nowrap", voided && "line-through")}>
                    {formatXof(e.amountXof)}
                  </p>
                </div>

                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {e.attachments.length > 0 ? (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {e.attachments.map((a) => (
                        <li key={a.id}>
                          <a
                            href={`/api/depenses/pieces/${a.id}`}
                            target="_blank"
                            rel="noopener"
                            className="text-brand hover:underline"
                          >
                            {a.fileName}
                          </a>{" "}
                          <span className="text-xs text-muted-foreground">({sizeLabel(a.sizeBytes)})</span>{" "}
                          {!voided && <RemoveAttachmentButton attachmentId={a.id} fileName={a.fileName} />}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !voided && <p className="text-xs text-amber-700 dark:text-amber-400">Aucun justificatif.</p>
                  )}
                  {!voided && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Joindre un justificatif ou annuler
                      </summary>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <AttachmentForm expenseId={e.id} />
                        <VoidExpenseForm expenseId={e.id} />
                      </div>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="max-w-2xl rounded-xl border bg-card p-5" aria-labelledby="categories">
        <h2 id="categories" className="mb-1 text-sm font-medium">
          Catégories
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Une catégorie déjà utilisée n&apos;est jamais supprimée : masquez-la pour ne plus la proposer.
        </p>
        <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {data.categories.map((c) => (
            <li key={c.id} className={cn(!c.isActive && "text-muted-foreground line-through")}>
              {c.name} <ToggleCategoryButton categoryId={c.id} isActive={c.isActive} />
            </li>
          ))}
        </ul>
        <CategoryForm />
      </section>
    </>
  );
}
