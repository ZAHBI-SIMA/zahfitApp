import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { CASH_MOVEMENT_LABELS, listCashMovements } from "@/modules/cash/cash.service";
import { parsePeriod, periodRange } from "@/modules/payments/payments.service";
import { isoDate, todayCalendar } from "@/modules/subscriptions/dates";

/** Mouvements d'espèces d'une période (CSV « ; » + BOM : s'ouvre dans Excel). Export journalisé. */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx || !can(ctx.role, "finance.reports.read")) return new Response("Accès refusé.", { status: 403 });
  // Accès du support : pas d'export massif (ni de trace au nom du compte consulté).
  if (ctx.supportAccess) return new Response("Export indisponible pendant un accès du support.", { status: 403 });

  const period = parsePeriod(new URL(request.url).searchParams.get("periode"));
  const today = todayCalendar();
  const rows = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const result = await listCashMovements(tx, periodRange(period, today));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "cash.export",
      entityType: "cash_movement",
      after: { period, rows: result.length },
    });
    return result;
  });

  const header = ["Date", "Caisse", "Type", "Libellé", "N° pièce", "Montant (FCFA)", "Par"];
  const lines = rows.map((m) => [
    formatDateTime(m.createdAt),
    m.sessionId ? m.sessionId.slice(0, 8) : "hors caisse",
    CASH_MOVEMENT_LABELS[m.kind],
    m.label,
    m.receiptNumber ?? "",
    m.amountXof,
    m.createdByName,
  ]);
  const csv = "\uFEFF" + [header, ...lines].map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="caisse-${period}-${isoDate(today)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
