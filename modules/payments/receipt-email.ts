import "server-only";
import { withTenant } from "@/lib/db";
import { formatDate, formatDateTime, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { sendMail } from "@/lib/mail";
import { formatPhone } from "@/lib/phone";
import { loadReceipt, type LoadedReceipt } from "@/modules/payments/payments.service";
import { renderReceiptPdf, type ReceiptPdfData } from "@/modules/payments/receipt-pdf";

/** Données du reçu → contenu du PDF (une seule source pour le téléchargement et l'e-mail). */
export function toReceiptPdfData(loaded: LoadedReceipt): ReceiptPdfData {
  const { receipt, payment } = loaded;
  const t = receipt.tenant;
  const sub = payment.subscription;
  const isRefund = payment.kind === "REFUND";
  return {
    number: receipt.number,
    isRefund,
    issuedAt: formatDateTime(receipt.issuedAt),
    tenant: {
      name: t.name,
      addressLine: [t.address, t.commune, t.city].filter(Boolean).join(", ") || null,
      contactLine: [t.phone && formatPhone(t.phone), t.email].filter(Boolean).join(" · ") || null,
      footer: t.receiptFooter,
    },
    member: {
      code: payment.member.code,
      name: `${payment.member.lastName} ${payment.member.firstName}`,
      phone: formatPhone(payment.member.phone),
    },
    label: sub ? `Abonnement ${sub.planName}` : "Paiement",
    period: sub ? `du ${formatDate(sub.startDate)} au ${formatDate(sub.endDate)}` : null,
    amount: formatXof(payment.amountXof),
    method: PAYMENT_METHOD_LABELS[payment.method],
    reference: payment.providerRef,
    cashier: loaded.cashierName,
    refundOf: payment.refundOf?.receipt?.number ?? null,
    reason: isRefund ? payment.reason : null,
    summary:
      sub && loaded.paidAtThatTime !== null
        ? {
            price: formatXof(sub.priceXof),
            paid: formatXof(loaded.paidAtThatTime),
            balance: formatXof(Math.max(0, sub.priceXof - loaded.paidAtThatTime)),
          }
        : null,
  };
}

/**
 * Envoie le reçu par e-mail si l'adhérent a une adresse. Appelé APRÈS la
 * transaction : un e-mail en échec ne doit jamais annuler un encaissement.
 * Message transactionnel (pas commercial) : pas besoin du consentement e-mail.
 */
export async function sendReceiptByEmail(ctx: { tenantId: string; userId: string }, receiptId: string): Promise<boolean> {
  try {
    const loaded = await withTenant(ctx.tenantId, ctx.userId, (tx) => loadReceipt(tx, receiptId));
    const email = loaded?.payment.member.email;
    if (!loaded || !email) return false;
    const data = toReceiptPdfData(loaded);
    const pdf = await renderReceiptPdf(data);
    await sendMail({
      to: email,
      subject: `${data.tenant.name} — ${data.isRefund ? "Avoir" : "Reçu"} ${data.number}`,
      text: `Bonjour ${loaded.payment.member.firstName}, veuillez trouver ci-joint votre ${data.isRefund ? "avoir" : "reçu"} n° ${data.number} (${data.amount}).`,
      html: `<p>Bonjour ${loaded.payment.member.firstName},</p><p>Veuillez trouver ci-joint votre ${data.isRefund ? "avoir" : "reçu"} n° <strong>${data.number}</strong> (${data.amount}).</p><p>${data.tenant.name}</p>`,
      attachments: [{ filename: `${data.number}.pdf`, content: Buffer.from(pdf).toString("base64") }],
    });
    return true;
  } catch (error) {
    console.error("[recu] échec de l'envoi par e-mail", error instanceof Error ? error.message : error);
    return false;
  }
}
