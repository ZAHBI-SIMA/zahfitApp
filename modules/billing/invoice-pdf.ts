import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatDate, formatXof } from "@/lib/format";
import type { PaymentMethod, SaasInvoiceKind, SaasInvoiceStatus } from "@/lib/generated/prisma/enums";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { pdfSafe } from "@/modules/payments/receipt-pdf";

const NAVY = rgb(0x1f / 255, 0x2e / 255, 0x42 / 255);
const ORANGE = rgb(0xe6 / 255, 0x73 / 255, 0x34 / 255);
const GREY = rgb(0.42, 0.45, 0.5);

export type SaasInvoicePdfData = {
  number: string;
  kind: SaasInvoiceKind;
  status: SaasInvoiceStatus;
  planName: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  amountXof: number;
  issuedOn: Date;
  dueOn: Date;
  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  tenant: { name: string; address: string | null; city: string | null; email: string | null };
};

/** Facture ZahDigit (A4). Mentions légales de l'émetteur : variable ZAHDIGIT_LEGAL. */
export async function renderSaasInvoicePdf(d: SaasInvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Facture ${d.number}`));
  pdf.setProducer("ZAHFIT");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595, 842];
  const m = 50;
  const page = pdf.addPage([W, H]);
  const text = (v: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: typeof NAVY } = {}) =>
    page.drawText(pdfSafe(v), { x, y, font: o.font ?? regular, size: o.size ?? 10, color: o.color ?? NAVY });
  const right = (v: string, y: number, o: { font?: PDFFont; size?: number; color?: typeof NAVY } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const safe = pdfSafe(v);
    text(safe, W - m - font.widthOfTextAtSize(safe, size), y, o);
  };

  page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: NAVY });
  text("ZahDigit", m, H - 50, { font: bold, size: 20, color: rgb(1, 1, 1) });
  text("Éditeur de ZAHFIT", m, H - 68, { size: 9, color: rgb(0.85, 0.88, 0.92) });
  right("FACTURE", H - 50, { font: bold, size: 16, color: rgb(1, 1, 1) });
  right(`N° ${d.number}`, H - 68, { size: 10, color: rgb(0.85, 0.88, 0.92) });

  let y = H - 130;
  text("Facturé à", m, y, { size: 9, color: GREY });
  right(`Émise le ${formatDate(d.issuedOn)}`, y, { size: 9, color: GREY });
  y -= 16;
  text(d.tenant.name, m, y, { font: bold, size: 12 });
  right(`Échéance : ${formatDate(d.dueOn)}`, y, { font: bold, size: 10 });
  y -= 14;
  const address = [d.tenant.address, d.tenant.city].filter(Boolean).join(", ");
  if (address) {
    text(address, m, y, { size: 9, color: GREY });
    y -= 12;
  }
  if (d.tenant.email) text(d.tenant.email, m, y, { size: 9, color: GREY });

  y -= 50;
  page.drawLine({ start: { x: m, y: y + 14 }, end: { x: W - m, y: y + 14 }, thickness: 0.5, color: GREY });
  text("Désignation", m, y, { size: 9, color: GREY });
  right("Montant", y, { size: 9, color: GREY });
  y -= 22;
  const label =
    d.kind === "SETUP"
      ? `Frais d'installation et de mise en service — forfait ${d.planName}`
      : `Abonnement ZAHFIT ${d.planName}`;
  text(label, m, y, { font: bold });
  right(formatXof(d.amountXof), y, { font: bold });
  if (d.periodStart && d.periodEnd) {
    y -= 14;
    text(`Période du ${formatDate(d.periodStart)} au ${formatDate(d.periodEnd)}`, m, y, { size: 9, color: GREY });
  }
  y -= 24;
  page.drawLine({ start: { x: m, y: y + 10 }, end: { x: W - m, y: y + 10 }, thickness: 0.5, color: GREY });
  y -= 14;
  text("Total à payer", m, y, { font: bold, size: 12 });
  right(formatXof(d.amountXof), y, { font: bold, size: 16, color: d.status === "PAID" ? NAVY : ORANGE });

  y -= 40;
  if (d.status === "PAID") {
    const method = d.paymentMethod ? ` par ${PAYMENT_METHOD_LABELS[d.paymentMethod]}` : "";
    const ref = d.paymentReference ? ` (réf. ${d.paymentReference})` : "";
    text(`Réglée le ${d.paidAt ? formatDate(d.paidAt) : "—"}${method}${ref}.`, m, y, { font: bold });
  } else if (d.status === "VOID") {
    text("FACTURE ANNULÉE", m, y, { font: bold, color: ORANGE });
  } else {
    text("Règlement en Mobile Money depuis ZAHFIT : Administration → Abonnement ZAHFIT.", m, y, { size: 9 });
  }

  const legal = process.env.ZAHDIGIT_LEGAL || "ZahDigit — Abidjan, Côte d'Ivoire";
  text(legal, m, 40, { size: 8, color: GREY });
  text("Montants en francs CFA (XOF).", m, 28, { size: 8, color: GREY });
  return pdf.save();
}
