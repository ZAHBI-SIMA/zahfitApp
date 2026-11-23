import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Reçu PDF (format A5) généré avec pdf-lib — JavaScript pur, aucune
 * dépendance native : fonctionne en serverless comme sur un VPS.
 */

export type ReceiptPdfData = {
  number: string;
  isRefund: boolean;
  issuedAt: string; // déjà formaté (fuseau Africa/Abidjan)
  tenant: { name: string; addressLine: string | null; contactLine: string | null; footer: string | null };
  member: { code: string; name: string; phone: string };
  label: string; // « Abonnement Mensuel »
  period: string | null; // « du 22 nov. 2026 au 21 déc. 2026 »
  amount: string; // « 20 000 FCFA »
  method: string;
  reference: string | null;
  cashier: string | null;
  refundOf: string | null; // n° du reçu remboursé
  reason: string | null;
  summary: { price: string; paid: string; balance: string } | null;
};

/**
 * Les polices standard du PDF (WinAnsi) ne couvrent que le latin étendu.
 * Intl.NumberFormat("fr-FR") produit des espaces fines insécables (U+202F)
 * qui feraient échouer l'écriture : on les normalise, ainsi que les rares
 * caractères hors jeu (remplacés par « ? » plutôt qu'un plantage).
 */
export function pdfSafe(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[    ]/g, " ")
    .replace(/→/g, "->")
    .replace(/[–—]/g, "-")
    // drapeau « u » : un emoji (paire de substitution UTF-16) compte pour UN caractère
    .replace(/[^\x20-\x7E¡-ÿ’…€Œœ]/gu, "?");
}

const NAVY = rgb(0x1f / 255, 0x2e / 255, 0x42 / 255);
const ORANGE = rgb(0xe6 / 255, 0x73 / 255, 0x34 / 255);
const GREY = rgb(0.42, 0.45, 0.5);
type Color = ReturnType<typeof rgb>;

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${data.isRefund ? "Avoir" : "Reçu"} ${data.number}`));
  pdf.setProducer("ZAHFIT");
  const page = pdf.addPage([420, 595]); // A5 portrait, en points
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 32;

  const text = (value: string, x: number, y: number, opts: { font?: PDFFont; size?: number; color?: Color } = {}) =>
    page.drawText(pdfSafe(value), { x, y, font: opts.font ?? regular, size: opts.size ?? 10, color: opts.color ?? NAVY });
  const rightText = (value: string, y: number, opts: { font?: PDFFont; size?: number; color?: Color; inset?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const safe = pdfSafe(value);
    page.drawText(safe, {
      x: width - margin - (opts.inset ?? 0) - font.widthOfTextAtSize(safe, size),
      y,
      font,
      size,
      color: opts.color ?? NAVY,
    });
  };

  // En-tête de la salle
  page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: NAVY });
  text(data.tenant.name, margin, height - 42, { font: bold, size: 16, color: rgb(1, 1, 1) });
  if (data.tenant.addressLine) text(data.tenant.addressLine, margin, height - 60, { size: 9, color: rgb(0.85, 0.88, 0.92) });
  if (data.tenant.contactLine) text(data.tenant.contactLine, margin, height - 74, { size: 9, color: rgb(0.85, 0.88, 0.92) });

  // Titre et numéro
  let y = height - 130;
  text(data.isRefund ? "AVOIR" : "REÇU DE PAIEMENT", margin, y, { font: bold, size: 14, color: data.isRefund ? ORANGE : NAVY });
  rightText(`N° ${data.number}`, y, { font: bold, size: 12 });
  y -= 16;
  text(`Émis le ${data.issuedAt}`, margin, y, { size: 9, color: GREY });

  // Adhérent
  y -= 34;
  text("Adhérent", margin, y, { size: 9, color: GREY });
  y -= 15;
  text(data.member.name, margin, y, { font: bold, size: 11 });
  y -= 14;
  text(`${data.member.code} · ${data.member.phone}`, margin, y, { size: 9, color: GREY });

  // Ligne détaillée
  y -= 32;
  page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: width - margin, y: y + 12 }, thickness: 0.5, color: GREY });
  text(data.label, margin, y - 4, { font: bold, size: 11 });
  if (data.period) text(data.period, margin, y - 18, { size: 9, color: GREY });
  rightText(data.isRefund ? `- ${data.amount}` : data.amount, y - 4, { font: bold, size: 11 });
  y -= 34;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: GREY });

  // Montant
  y -= 30;
  text(data.isRefund ? "Montant remboursé" : "Montant encaissé", margin, y);
  rightText(data.amount, y - 2, { font: bold, size: 18, color: data.isRefund ? ORANGE : NAVY });

  // Détails du paiement
  y -= 34;
  const detail = (label: string, value: string | null) => {
    if (!value) return;
    text(label, margin, y, { size: 9, color: GREY });
    text(value, margin + 110, y, { size: 9 });
    y -= 14;
  };
  detail("Moyen de paiement", data.method);
  detail("Référence", data.reference);
  detail("Encaissé par", data.cashier);
  detail("Avoir sur le reçu", data.refundOf);
  detail("Motif", data.reason);

  if (data.summary) {
    y -= 10;
    page.drawRectangle({ x: margin, y: y - 44, width: width - 2 * margin, height: 54, color: rgb(0.95, 0.96, 0.97) });
    const row = (label: string, value: string, offset: number, strong = false) => {
      text(label, margin + 10, y - offset, { size: 9, font: strong ? bold : regular });
      rightText(value, y - offset, { size: 9, font: strong ? bold : regular, inset: 10 });
    };
    row("Prix de l'abonnement", data.summary.price, 6);
    row("Total payé à ce jour", data.summary.paid, 20);
    row("Reste à payer", data.summary.balance, 34, true);
  }

  // Pied de page
  const footer = [data.tenant.footer, "Document généré par ZAHFIT · conservez ce reçu."].filter(Boolean) as string[];
  footer.forEach((line, i) => text(line, margin, 40 - i * 12, { size: 8, color: GREY }));

  return pdf.save();
}
