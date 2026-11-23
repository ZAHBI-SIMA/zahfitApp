import * as z from "zod";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { renderSaleTicketPdf } from "@/modules/shop/sale-ticket-pdf";
import { loadSale } from "@/modules/shop/shop.service";

/**
 * Ticket de vente PDF : personnel (vente ou contrôle), ou l'adhérent pour SES
 * achats. La RLS renvoie 404 pour une vente d'une autre salle.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/ventes/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Ticket introuvable.", { status: 404 });
  const ctx = await getTenantContext();
  if (!ctx) return new Response("Accès refusé.", { status: 403 });

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    sale: await loadSale(tx, id),
    tenant: await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: { name: true, address: true, commune: true, city: true, phone: true, receiptFooter: true },
    }),
  }));
  if (!data.sale) return new Response("Ticket introuvable.", { status: 404 });

  const staff = can(ctx.role, "shop.sell") || can(ctx.role, "finance.reports.read");
  const ownPurchase = can(ctx.role, "self.payments") && data.sale.member?.userId === ctx.user.id;
  if (!staff && !ownPurchase) return new Response("Accès refusé.", { status: 403 });

  const pdf = await renderSaleTicketPdf(data.sale, data.tenant);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.sale.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
