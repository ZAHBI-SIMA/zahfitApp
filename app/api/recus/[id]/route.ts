import * as z from "zod";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { loadReceipt } from "@/modules/payments/payments.service";
import { toReceiptPdfData } from "@/modules/payments/receipt-email";
import { renderReceiptPdf } from "@/modules/payments/receipt-pdf";

/**
 * Téléchargement d'un reçu PDF. Autorisé au personnel ayant `payments.read`,
 * ou à l'adhérent pour SES propres reçus. Le RLS garantit en plus qu'un
 * identifiant d'une autre salle renvoie 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/recus/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Reçu introuvable.", { status: 404 });

  const ctx = await getTenantContext();
  if (!ctx) return new Response("Accès refusé.", { status: 403 });

  const loaded = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => loadReceipt(tx, id));
  if (!loaded) return new Response("Reçu introuvable.", { status: 404 });

  const isOwnReceipt = can(ctx.role, "self.payments") && loaded.payment.member.userId === ctx.user.id;
  if (!can(ctx.role, "payments.read") && !isOwnReceipt) return new Response("Accès refusé.", { status: 403 });

  const pdf = await renderReceiptPdf(toReceiptPdfData(loaded));
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${loaded.receipt.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
