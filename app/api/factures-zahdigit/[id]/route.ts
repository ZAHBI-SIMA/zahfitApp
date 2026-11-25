import * as z from "zod";
import { withDbContext, withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { getSessionUser, getTenantContext, isSuperAdmin } from "@/lib/session";
import { renderSaasInvoicePdf } from "@/modules/billing/invoice-pdf";

const select = {
  number: true,
  kind: true,
  status: true,
  planName: true,
  periodStart: true,
  periodEnd: true,
  amountXof: true,
  issuedOn: true,
  dueOn: true,
  paidAt: true,
  paymentMethod: true,
  paymentReference: true,
  tenant: { select: { name: true, address: true, city: true, email: true } },
} as const;

/** Facture ZahDigit en PDF : Super Admin, ou administrateur de la salle concernée (RLS). */
export async function GET(_request: Request, { params }: RouteContext<"/api/factures-zahdigit/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Facture introuvable.", { status: 404 });
  const user = await getSessionUser();
  if (!user) return new Response("Accès refusé.", { status: 403 });

  let invoice;
  if (isSuperAdmin(user)) {
    invoice = await withDbContext({ userId: user.id, platform: true }, (tx) =>
      tx.saasInvoice.findUnique({ where: { id }, select }),
    );
  } else {
    const ctx = await getTenantContext();
    if (!ctx || !can(ctx.role, "billing.settings.manage")) return new Response("Accès refusé.", { status: 403 });
    invoice = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => tx.saasInvoice.findUnique({ where: { id }, select }));
  }
  if (!invoice) return new Response("Facture introuvable.", { status: 404 });

  const pdf = await renderSaasInvoicePdf(invoice);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
