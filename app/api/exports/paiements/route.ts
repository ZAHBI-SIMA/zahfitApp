import { audit } from "@/lib/audit";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { listPayments, parsePeriod, periodRange } from "@/modules/payments/payments.service";
import { isoDate, todayCalendar } from "@/modules/subscriptions/dates";

/** Cellule CSV : guillemets seulement si nécessaire (séparateur, guillemet, retour ligne). */
const cell = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Export comptable des transactions confirmées. CSV « ; » + BOM UTF-8 :
 * s'ouvre directement dans Excel en français. L'export est journalisé
 * (données financières et personnelles).
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx || !can(ctx.role, "finance.reports.read")) return new Response("Accès refusé.", { status: 403 });

  const period = parsePeriod(new URL(request.url).searchParams.get("periode"));
  const today = todayCalendar();
  const { rows } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const result = await listPayments(tx, periodRange(period, today));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "payments.export",
      entityType: "payment",
      after: { period, rows: result.rows.length },
    });
    return result;
  });

  const header = [
    "Date",
    "N° pièce",
    "Type",
    "Code adhérent",
    "Adhérent",
    "Formule",
    "Moyen de paiement",
    "Référence",
    "Montant (FCFA)",
    "Encaissé par",
    "Motif",
  ];
  const lines = rows.map((p) => [
    formatDateTime(p.paidAt),
    p.receipt?.number ?? "",
    p.kind === "REFUND" ? "Remboursement" : "Encaissement",
    p.member.code,
    `${p.member.lastName} ${p.member.firstName}`,
    p.subscription?.planName ?? "",
    PAYMENT_METHOD_LABELS[p.method],
    p.providerRef ?? "",
    p.signedAmount, // entier sans séparateur : directement sommable dans Excel
    p.cashierName,
    p.reason ?? "",
  ]);
  const csv = "﻿" + [header, ...lines].map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paiements-${period}-${isoDate(today)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
