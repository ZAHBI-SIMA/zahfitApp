import type { NotificationType } from "@/lib/generated/prisma/enums";

/**
 * Modèles des notifications — fonctions PURES : un événement et ses données
 * deviennent un titre, un texte et un lien (application) et un e-mail.
 * Textes courts, en français, sans données sensibles.
 */

export type TemplateData = {
  tenantName: string;
  firstName: string;
  className?: string;
  /** « mardi 24 nov. à 18:00 » */
  when?: string;
  reason?: string;
  position?: number;
  planName?: string;
  /** « 22 déc. 2026 » */
  endDate?: string;
  startDate?: string;
  days?: number;
  amount?: string;
  receiptNumber?: string;
  memberCode?: string;
  /** Lien de renouvellement en un clic (chemin relatif : /s/<salle>/renouveler/<jeton>) */
  renewPath?: string;
};

export type Rendered = { title: string; body: string; link: string | null };

/** Canal e-mail par défaut (en plus de l'application) pour chaque événement. */
export const EMAIL_BY_DEFAULT: Record<NotificationType, boolean> = {
  MEMBER_WELCOME: true,
  BOOKING_CONFIRMED: true,
  BOOKING_WAITLISTED: true,
  WAITLIST_PROMOTED: true,
  BOOKING_CANCELLED: true,
  SESSION_CANCELLED: true,
  SUBSCRIPTION_EXPIRING: true,
  SUBSCRIPTION_EXPIRED: true,
  // Le reçu PDF part déjà par e-mail : ces trois-là restent dans l'application.
  SUBSCRIPTION_ACTIVATED: false,
  SUBSCRIPTION_RENEWED: false,
  PAYMENT_CONFIRMED: false,
};

export function render(type: NotificationType, d: TemplateData): Rendered {
  switch (type) {
    case "MEMBER_WELCOME":
      return {
        title: `Bienvenue chez ${d.tenantName}`,
        body: `Votre inscription est enregistrée${d.memberCode ? ` (n° adhérent ${d.memberCode})` : ""}. À très vite !`,
        link: "/member",
      };
    case "BOOKING_CONFIRMED":
      return {
        title: `Réservation confirmée : ${d.className}`,
        body: `Votre place est réservée pour ${d.className}, ${d.when}.`,
        link: "/member/reservations",
      };
    case "BOOKING_WAITLISTED":
      return {
        title: `Liste d'attente : ${d.className}`,
        body: `${d.className}, ${d.when}, est complet. Vous êtes n° ${d.position} sur la liste d'attente : vous serez prévenu(e) si une place se libère.`,
        link: "/member/reservations",
      };
    case "WAITLIST_PROMOTED":
      return {
        title: `Une place s'est libérée : ${d.className}`,
        body: `Bonne nouvelle : votre place est confirmée pour ${d.className}, ${d.when}. Si vous ne pouvez plus venir, annulez pour la laisser à quelqu'un d'autre.`,
        link: "/member/reservations",
      };
    case "BOOKING_CANCELLED":
      return {
        title: `Réservation annulée : ${d.className}`,
        body: `Votre réservation pour ${d.className}, ${d.when}, est annulée.${d.reason ? ` Motif : ${d.reason}.` : ""}`,
        link: "/member/reservations",
      };
    case "SESSION_CANCELLED":
      return {
        title: `Cours annulé : ${d.className}`,
        body: `La séance ${d.className} du ${d.when} est annulée${d.reason ? ` (${d.reason})` : ""}. Votre réservation est libérée ; vous pouvez réserver une autre séance.`,
        link: "/member/reservations",
      };
    case "SUBSCRIPTION_EXPIRING":
      return {
        title: `Votre abonnement se termine dans ${d.days} jours`,
        body: `Votre abonnement ${d.planName} prend fin le ${d.endDate}. ${
          d.renewPath ? "Renouvelez-le en un clic" : "Renouvelez-le à l'accueil"
        } pour continuer sans interruption.`,
        link: d.renewPath ?? "/member",
      };
    case "SUBSCRIPTION_EXPIRED":
      return {
        title: "Votre abonnement est arrivé à échéance",
        body: `Votre abonnement ${d.planName} a pris fin le ${d.endDate}. ${
          d.renewPath ? "Renouvelez-le en un clic, ou passez à l'accueil." : "Passez à l'accueil pour le renouveler."
        }`,
        link: d.renewPath ?? "/member",
      };
    case "SUBSCRIPTION_ACTIVATED":
      return {
        title: `Abonnement ${d.planName} actif`,
        body: `Votre abonnement est valable du ${d.startDate} au ${d.endDate}.`,
        link: "/member",
      };
    case "SUBSCRIPTION_RENEWED":
      return {
        title: `Abonnement ${d.planName} renouvelé`,
        body: `Merci ! Votre nouvel abonnement court du ${d.startDate} au ${d.endDate}.`,
        link: "/member",
      };
    case "PAYMENT_CONFIRMED":
      return {
        title: "Paiement reçu",
        body: `Paiement de ${d.amount} enregistré${d.receiptNumber ? ` — reçu ${d.receiptNumber}` : ""}.`,
        link: "/member",
      };
  }
}

/** E-mail texte : salutation, message, signature de la salle. */
export function emailText(d: TemplateData, r: Rendered, appUrl: string): string {
  const link = r.link ? `\n\nVotre espace : ${appUrl}${r.link}` : "";
  return `Bonjour ${d.firstName},\n\n${r.body}${link}\n\n${d.tenantName}`;
}
