import * as z from "zod";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { renderCashReportPdf } from "@/modules/cash/cash-report-pdf";
import { cashSessionReport } from "@/modules/cash/cash.service";
import { isoDate } from "@/modules/subscriptions/dates";

/**
 * Z de caisse en PDF. Réservé au contrôle (gérant, comptable, admin) ; la
 * RLS renvoie 404 pour une caisse d'une autre salle.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/caisse/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Caisse introuvable.", { status: 404 });
  const ctx = await getTenantContext();
  if (!ctx || !(can(ctx.role, "finance.reports.read") || can(ctx.role, "cash.manage"))) {
    return new Response("Accès refusé.", { status: 403 });
  }
  const report = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => cashSessionReport(tx, id));
  if (!report) return new Response("Caisse introuvable.", { status: 404 });

  const pdf = await renderCashReportPdf(report, ctx.tenant.name);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="z-caisse-${isoDate(report.session.openedAt)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
