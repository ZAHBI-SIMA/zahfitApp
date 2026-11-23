import { describe, expect, it } from "vitest";
import { formatXof } from "@/lib/format";
import { activationThreshold, periodRange, receiptNumber } from "@/modules/payments/payments.service";
import { pdfSafe, renderReceiptPdf } from "@/modules/payments/receipt-pdf";
import { isoDate, parseCalendarDate } from "@/modules/subscriptions/dates";

describe("pdfSafe", () => {
  it("remplace les espaces fines insécables produites par Intl (« 20 000 FCFA »)", () => {
    const amount = formatXof(20_000);
    expect(amount).toMatch(/ | /); // le piège existe bien
    expect(pdfSafe(amount)).toBe("20 000 FCFA");
  });
  it("conserve les accents français et remplace les caractères hors police", () => {
    expect(pdfSafe("Reçu — Koné → payé")).toBe("Reçu - Koné -> payé");
    expect(pdfSafe("emoji 🏋️")).toBe("emoji ??");
  });
});

describe("renderReceiptPdf", () => {
  it("produit un PDF valide avec accents, montants formatés et avoir", async () => {
    const bytes = await renderReceiptPdf({
      number: "AV-000012",
      isRefund: true,
      issuedAt: "22/11/2026 17:45",
      tenant: { name: "Salle Pilote Cocody", addressLine: "Riviera 2, Cocody, Abidjan", contactLine: "07 01 02 03 04", footer: "RCCM CI-ABJ-2026" },
      member: { code: "ADH-000001", name: "Koné Awa", phone: "07 01 02 03 04" },
      label: "Abonnement Mensuel",
      period: "du 22 nov. 2026 au 21 déc. 2026",
      amount: formatXof(5_000),
      method: "Mobile Money",
      reference: "MP261122.1745.A1",
      cashier: "Mariam Traoré",
      refundOf: "REC-000011",
      reason: "Déménagement",
      summary: { price: formatXof(20_000), paid: formatXof(15_000), balance: formatXof(5_000) },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("règles d'encaissement", () => {
  it("seuil d'activation : prix complet sans paiement partiel, acompte sinon (arrondi au supérieur)", () => {
    expect(activationThreshold(20_000, { allowPartialPayment: false, minDepositPercent: 50 })).toBe(20_000);
    expect(activationThreshold(20_000, { allowPartialPayment: true, minDepositPercent: 50 })).toBe(10_000);
    expect(activationThreshold(15_000, { allowPartialPayment: true, minDepositPercent: 33 })).toBe(4_950);
    expect(activationThreshold(1_001, { allowPartialPayment: true, minDepositPercent: 50 })).toBe(501);
  });
  it("numérotation des pièces", () => {
    expect(receiptNumber(1, "PAYMENT")).toBe("REC-000001");
    expect(receiptNumber(42, "REFUND")).toBe("AV-000042");
  });
  it("le mois précédent couvre le changement d'année", () => {
    const r = periodRange("mois-precedent", parseCalendarDate("2027-01-15")!);
    expect([isoDate(r.from), isoDate(r.to)]).toEqual(["2026-12-01", "2027-01-01"]);
  });
});
