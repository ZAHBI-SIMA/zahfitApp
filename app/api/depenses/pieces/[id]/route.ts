import * as z from "zod";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { loadAttachment } from "@/modules/expenses/expenses.service";

/**
 * Justificatif d'une dépense. Le type servi est celui détecté à l'envoi
 * (octets réels), jamais celui annoncé par le navigateur ; `nosniff` et une
 * CSP fermée empêchent tout contenu actif. Les PDF sont téléchargés.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/depenses/pieces/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Justificatif introuvable.", { status: 404 });
  const ctx = await getTenantContext();
  if (!ctx || !(can(ctx.role, "expenses.manage") || can(ctx.role, "finance.reports.read"))) {
    return new Response("Accès refusé.", { status: 403 });
  }
  const file = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => loadAttachment(tx, id));
  if (!file) return new Response("Justificatif introuvable.", { status: 404 });

  const disposition = file.mimeType.startsWith("image/") ? "inline" : "attachment";
  const asciiName = file.fileName.replace(/[^\x20-\x7E]/g, "_");
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
