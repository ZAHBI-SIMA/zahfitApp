/**
 * Envoi d'e-mails transactionnels.
 * - RESEND_API_KEY défini → envoi réel via l'API Resend.
 * - sinon (développement) → affichage dans la console du serveur.
 */
type Mail = { to: string; subject: string; html: string; text: string };

export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`\n[mail:dev] → ${mail.to}\n  Objet : ${mail.subject}\n  ${mail.text}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "ZAHFIT <no-reply@zahfit.app>",
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    // On ne journalise pas le corps : il peut contenir l'adresse du destinataire.
    throw new Error(`Échec de l'envoi d'e-mail (Resend ${res.status})`);
  }
}
