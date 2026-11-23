import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDateTime, formatXof } from "@/lib/format";
import { CASH_MOVEMENT_LABELS, type CashSessionReport } from "@/modules/cash/cash.service";
import { pdfSafe } from "@/modules/payments/receipt-pdf";

/**
 * « Z de caisse » (A4) : synthèse de la session, détail des mouvements,
 * comptage, écart et signatures. Paginé : une journée chargée tient sur
 * plusieurs pages sans rien tronquer.
 */

const NAVY = rgb(0x1f / 255, 0x2e / 255, 0x42 / 255);
const ORANGE = rgb(0xe6 / 255, 0x73 / 255, 0x34 / 255);
const GREY = rgb(0.42, 0.45, 0.5);
type Color = ReturnType<typeof rgb>;

const STATUS_LABELS = { OPEN: "Ouverte", CLOSED: "Clôturée, à valider", VALIDATED: "Validée" } as const;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatXof(Math.abs(n))}`;

export async function renderCashReportPdf(report: CashSessionReport, tenantName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Z de caisse — ${formatDateTime(report.session.openedAt)}`));
  pdf.setProducer("ZAHFIT");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595, 842];
  const margin = 40;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - margin;

  const text = (value: string, x: number, opts: { font?: PDFFont; size?: number; color?: Color } = {}) =>
    page.drawText(pdfSafe(value), { x, y, font: opts.font ?? regular, size: opts.size ?? 9, color: opts.color ?? NAVY });
  const right = (value: string, xRight: number, opts: { font?: PDFFont; size?: number; color?: Color } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9;
    const safe = pdfSafe(value);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, font, size, color: opts.color ?? NAVY });
  };
  /** Tronque un texte à une largeur donnée (points). */
  const fit = (value: string, maxWidth: number, font = regular, size = 9) => {
    let safe = pdfSafe(value);
    while (safe.length > 1 && font.widthOfTextAtSize(safe, size) > maxWidth) safe = `${safe.slice(0, -2)}…`;
    return safe;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - margin;
  };

  const { session } = report;

  // En-tête
  page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: NAVY });
  y = H - 42;
  text(tenantName, margin, { font: bold, size: 16, color: rgb(1, 1, 1) });
  right("Z DE CAISSE", W - margin, { font: bold, size: 14, color: rgb(1, 1, 1) });
  y = H - 60;
  text(`Statut : ${STATUS_LABELS[session.status]}`, margin, { size: 9, color: rgb(0.85, 0.88, 0.92) });

  // Synthèse
  y = H - 112;
  const info = (label: string, value: string) => {
    text(label, margin, { color: GREY });
    text(value, margin + 120);
    y -= 14;
  };
  info("Ouverture", `${formatDateTime(session.openedAt)} — ${session.openedByName}`);
  info("Clôture", session.closedAt ? `${formatDateTime(session.closedAt)} — ${session.closedByName}` : "—");
  info("Validation", session.validatedAt ? `${formatDateTime(session.validatedAt)} — ${session.validatedByName}` : "—");

  y -= 10;
  const rows: [string, string, boolean][] = [
    ["Fond de caisse initial", formatXof(session.openingFloatXof), false],
    ...report.byKind.map(
      (k): [string, string, boolean] => [`${CASH_MOVEMENT_LABELS[k.kind]} (${k.count})`, signed(k.amountXof), false],
    ),
    ["Théorique en caisse", formatXof(session.expectedXof ?? report.balance), true],
    ["Espèces comptées", session.countedXof === null ? "—" : formatXof(session.countedXof), true],
  ];
  const boxHeight = (rows.length + 1) * 15 + 8;
  page.drawRectangle({ x: margin, y: y - boxHeight + 14, width: W - 2 * margin, height: boxHeight, color: rgb(0.95, 0.96, 0.97) });
  for (const [label, value, strong] of rows) {
    text(label, margin + 10, { font: strong ? bold : regular });
    right(value, W - margin - 10, { font: strong ? bold : regular });
    y -= 15;
  }
  const diff = session.differenceXof;
  text("Écart (compté - théorique)", margin + 10, { font: bold });
  right(diff === null ? "—" : signed(diff), W - margin - 10, { font: bold, color: diff ? ORANGE : NAVY });
  y -= 28;

  if (session.closingNote) {
    text("Explication de l'écart :", margin, { color: GREY });
    text(fit(session.closingNote, W - 2 * margin - 130), margin + 130);
    y -= 14;
  }
  if (session.validationNote) {
    text("Suite donnée (gérant) :", margin, { color: GREY });
    text(fit(session.validationNote, W - 2 * margin - 130), margin + 130);
    y -= 14;
  }

  // Détail des mouvements
  y -= 16;
  text(`Mouvements (${report.movements.length})`, margin, { font: bold, size: 11 });
  y -= 18;
  const col = { time: margin, kind: margin + 92, label: margin + 180, by: margin + 380, amount: W - margin };
  const header = () => {
    text("Heure", col.time, { color: GREY });
    text("Type", col.kind, { color: GREY });
    text("Libellé", col.label, { color: GREY });
    text("Par", col.by, { color: GREY });
    right("Montant", col.amount, { color: GREY });
    y -= 6;
    page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: W - margin, y: y + 2 }, thickness: 0.5, color: GREY });
    y -= 10;
  };
  header();
  if (report.movements.length === 0) {
    text("Aucun mouvement.", margin, { color: GREY });
    y -= 14;
  }
  for (const m of report.movements) {
    if (y < margin + 40) {
      newPage();
      header();
    }
    text(formatDateTime(m.createdAt), col.time);
    text(CASH_MOVEMENT_LABELS[m.kind], col.kind);
    text(fit(m.label, col.by - col.label - 8), col.label);
    text(fit(m.createdByName, col.amount - col.by - 70), col.by);
    right(signed(m.amountXof), col.amount, { color: m.amountXof < 0 ? ORANGE : NAVY });
    y -= 14;
  }

  // Signatures
  if (y < margin + 110) newPage();
  y -= 30;
  text("Signature du caissier", margin, { color: GREY });
  text("Signature du gérant", W / 2 + 10, { color: GREY });
  y -= 40;
  page.drawLine({ start: { x: margin, y }, end: { x: W / 2 - 20, y }, thickness: 0.5, color: GREY });
  page.drawLine({ start: { x: W / 2 + 10, y }, end: { x: W - margin, y }, thickness: 0.5, color: GREY });

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(pdfSafe(`Document généré par ZAHFIT · page ${i + 1}/${pages.length}`), {
      x: margin,
      y: 24,
      size: 8,
      font: regular,
      color: GREY,
    }),
  );
  return pdf.save();
}
