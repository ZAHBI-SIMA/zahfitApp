import type { NotificationType } from "@/lib/generated/prisma/enums";
import type { TemplateData } from "@/modules/notifications/templates";

/**
 * Modèles WhatsApp et SMS — fonctions PURES.
 *
 * WhatsApp n'autorise, hors conversation ouverte par l'adhérent, que des
 * MODÈLES pré-approuvés par Meta (catégorie « utility » : messages de
 * service, pas de promotion). Le texte ci-dessous est celui à soumettre
 * dans le gestionnaire WhatsApp Business ; seules les variables {{1}}, {{2}}…
 * changent à l'envoi. Voir docs/WHATSAPP_MODELES.md.
 *
 * Seuls les événements qui justifient un message payant ont un modèle.
 */

export type ChannelTemplate = {
  /** Nom du modèle chez Meta (minuscules, chiffres, _) */
  name: string;
  /** Texte soumis à Meta, variables {{1}}… */
  body: string;
  params: (d: TemplateData, absolute: (path: string) => string) => string[];
  /** SMS de secours (court : 1 à 2 segments) */
  sms: (d: TemplateData, absolute: (path: string) => string) => string;
};

const renewLink = (d: TemplateData, absolute: (path: string) => string) =>
  d.renewPath ? absolute(d.renewPath) : absolute("/member");

export const CHANNEL_TEMPLATES: Partial<Record<NotificationType, ChannelTemplate>> = {
  SUBSCRIPTION_EXPIRING: {
    name: "zahfit_rappel_echeance",
    body: "Bonjour {{1}}, votre abonnement {{2}} chez {{3}} se termine le {{4}}. Renouvelez en un clic : {{5}}",
    params: (d, abs) => [d.firstName, d.planName ?? "", d.tenantName, d.endDate ?? "", renewLink(d, abs)],
    sms: (d, abs) =>
      `${d.tenantName} : ${d.firstName}, votre abonnement se termine le ${d.endDate}. Renouvelez : ${renewLink(d, abs)}`,
  },
  SUBSCRIPTION_EXPIRED: {
    name: "zahfit_abonnement_expire",
    body: "Bonjour {{1}}, votre abonnement {{2}} chez {{3}} a pris fin le {{4}}. Renouvelez en un clic : {{5}}",
    params: (d, abs) => [d.firstName, d.planName ?? "", d.tenantName, d.endDate ?? "", renewLink(d, abs)],
    sms: (d, abs) =>
      `${d.tenantName} : ${d.firstName}, votre abonnement a pris fin le ${d.endDate}. Renouvelez : ${renewLink(d, abs)}`,
  },
  SESSION_CANCELLED: {
    name: "zahfit_seance_annulee",
    body: "Bonjour {{1}}, la séance {{2}} du {{3}} chez {{4}} est annulée. Votre réservation est libérée.",
    params: (d) => [d.firstName, d.className ?? "", d.when ?? "", d.tenantName],
    sms: (d) => `${d.tenantName} : ${d.firstName}, la séance ${d.className} du ${d.when} est annulée.`,
  },
  WAITLIST_PROMOTED: {
    name: "zahfit_place_liberee",
    body: "Bonjour {{1}}, une place s'est libérée : vous êtes inscrit(e) à {{2}} le {{3}} chez {{4}}.",
    params: (d) => [d.firstName, d.className ?? "", d.when ?? "", d.tenantName],
    sms: (d) =>
      `${d.tenantName} : ${d.firstName}, une place s'est libérée, vous êtes inscrit(e) à ${d.className} le ${d.when}.`,
  },
};

/** Texte tel que l'adhérent le lira (journal des envois). */
export function renderTemplateBody(template: ChannelTemplate, params: string[]): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

/** « +2250701020304 » → « +225 •••• 0304 » (affichage du journal). */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} •••• ${e164.slice(-4)}`;
}
