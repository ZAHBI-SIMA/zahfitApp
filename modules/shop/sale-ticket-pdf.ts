import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatDateTime, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { pdfSafe } from "@/modules/payments/receipt-pdf";
import type { LoadedSale } from "@/modules/shop/shop.service";

/**
 * Ticket de vente boutique au format ticket de caisse (80 mm de large),
 * hauteur ajustée au nombre de lignes. Numéro continu VTE-000001.
 */

const NAVY = rgb(0x1f / 255, 0x2e / 255, 0x42 / 255);
const GREY = rgb(0.42, 0.45, 0.5);

type TenantHeader = {
  name: string;
  address: string | null;
  commune: string | null;
  city: string | null;
  phone: string | null;
  receiptFooter: string | null;
};

export async function renderSaleTicketPdf(sale: LoadedSale, tenant: TenantHeader): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Ticket ${sale.number}`));
  pdf.setProducer("ZAHFIT");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 227; // 80 mm
  const margin = 14;
  const H = 230 + sale.lines.length * 26 + (tenant.receiptFooter ? 14 : 0) + (sale.status === "VOIDED" ? 30 : 0);
  const page = pdf.addPage([W, H]);
  let y = H - 26;

  const text = (value: string, x: number, opts: { font?: PDFFont; size?: number; color?: typeof NAVY } = {}) =>
    page.drawText(pdfSafe(value), { x, y, font: opts.font ?? regular, size: opts.size ?? 8, color: opts.color ?? NAVY });
  const center = (value: string, opts: { font?: PDFFont; size?: number; color?: typeof NAVY } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 8;
    const safe = pdfSafe(value);
    text(safe, (W - font.widthOfTextAtSize(safe, size)) / 2, opts);
  };
  const right = (value: string, opts: { font?: PDFFont; size?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 8;
    const safe = pdfSafe(value);
    text(safe, W - margin - font.widthOfTextAtSize(safe, size), opts);
  };
  const rule = () => {
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: W - margin, y: y + 4 },
      thickness: 0.4,
      color: GREY,
      dashArray: [2, 2],
    });
    y -= 10;
  };
  const fit = (value: string, maxWidth: number) => {
    let safe = pdfSafe(value);
    while (safe.length > 1 && regular.widthOfTextAtSize(safe, 8) > maxWidth) safe = `${safe.slice(0, -2)}…`;
    return safe;
  };

  center(tenant.name, { font: bold, size: 11 });
  y -= 12;
  const address = [tenant.address, tenant.commune, tenant.city].filter(Boolean).join(", ");
  if (address) {
    center(fit(address, W - 2 * margin), { color: GREY });
    y -= 10;
  }
  if (tenant.phone) {
    center(formatPhone(tenant.phone), { color: GREY });
    y -= 10;
  }
  y -= 6;
  center(`TICKET ${sale.number}`, { font: bold, size: 9 });
  y -= 11;
  center(formatDateTime(sale.createdAt), { color: GREY });
  y -= 14;
  rule();

  for (const line of sale.lines) {
    text(fit(line.productName, W - 2 * margin), margin);
    y -= 11;
    text(`${line.quantity} x ${formatXof(line.unitPriceXof)}`, margin + 8, { color: GREY });
    right(formatXof(line.lineTotalXof));
    y -= 15;
  }
  rule();
  text("TOTAL", margin, { font: bold, size: 10 });
  right(formatXof(sale.totalXof), { font: bold, size: 10 });
  y -= 14;
  text(`Payé : ${PAYMENT_METHOD_LABELS[sale.method]}`, margin, { color: GREY });
  y -= 11;
  if (sale.reference) {
    text(fit(`Réf. ${sale.reference}`, W - 2 * margin), margin, { color: GREY });
    y -= 11;
  }
  if (sale.member) {
    text(fit(`Client : ${sale.member.lastName} ${sale.member.firstName} (${sale.member.code})`, W - 2 * margin), margin, {
      color: GREY,
    });
    y -= 11;
  }
  text(fit(`Vendeur : ${sale.soldByName}`, W - 2 * margin), margin, { color: GREY });
  y -= 14;
  if (sale.status === "VOIDED") {
    center("VENTE ANNULÉE", { font: bold, size: 10 });
    y -= 11;
    center(fit(sale.voidReason ?? "", W - 2 * margin), { color: GREY });
    y -= 14;
  }
  rule();
  if (tenant.receiptFooter) {
    center(fit(tenant.receiptFooter, W - 2 * margin), { size: 7, color: GREY });
    y -= 12;
  }
  center("Merci de votre visite !", { size: 8 });
  return pdf.save();
}
