import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { withTenant } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { listExpenses } from "@/modules/expenses/expenses.service";
import { parsePeriod, periodRange } from "@/modules/payments/payments.service";
import { isoDate, todayCalendar } from "@/modules/subscriptions/dates";

/** Journal des dépenses d'une période (CSV « ; » + BOM). Les annulées sont incluses, à 0, marquées. */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx || !can(ctx.role, "finance.reports.read")) return new Response("Accès refusé.", { status: 403 });

  const period = parsePeriod(new URL(request.url).searchParams.get("periode"));
  const today = todayCalendar();
  const { rows } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const result = await listExpenses(tx, periodRange(period, today));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "expenses.export",
      entityType: "expense",
      after: { period, rows: result.rows.length },
    });
    return result;
  });

  const header = [
    "Date",
    "Catégorie",
    "Libellé",
    "Fournisseur",
    "Moyen de paiement",
    "Référence",
    "Montant (FCFA)",
    "Statut",
    "Motif d'annulation",
    "Justificatifs",
    "Saisie par",
  ];
  const lines = rows.map((e) => [
    formatDate(e.spentOn),
    e.category.name,
    e.label,
    e.supplier ?? "",
    PAYMENT_METHOD_LABELS[e.method],
    e.reference ?? "",
    e.status === "VOIDED" ? 0 : e.amountXof, // une dépense annulée ne compte pas dans les sommes
    e.status === "VOIDED" ? "Annulée" : "Enregistrée",
    e.voidReason ?? "",
    e.attachments.length,
    e.recordedByName,
  ]);
  const csv = "\uFEFF" + [header, ...lines].map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="depenses-${period}-${isoDate(today)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
