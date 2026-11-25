import type { SaasSubscriptionStatus } from "@/lib/generated/prisma/enums";

/**
 * Conditions contractuelles de l'abonnement ZAHFIT (fichier PUR : un seul
 * endroit à modifier si le contrat évolue). Jours calendaires, Africa/Abidjan.
 */
export const BILLING_RULES = {
  /** Période d'essai offerte à la création d'une salle */
  trialDays: 30,
  /** Délai de paiement d'une facture après son émission */
  paymentTermsDays: 7,
  /** Retard à partir duquel le personnel passe en lecture seule */
  readOnlyAfterDays: 7,
  /** Retard à partir duquel l'accès est suspendu */
  suspendAfterDays: 15,
  /** Validité d'une tentative de paiement en ligne */
  paymentTtlMinutes: 30,
} as const;

/** Relances, par nombre de jours par rapport à l'échéance (négatif : avant). */
export const REMINDERS: { key: string; offset: number }[] = [
  { key: "J-3", offset: -3 },
  { key: "J0", offset: 0 },
  { key: "J+1", offset: 1 },
  { key: `J+${BILLING_RULES.readOnlyAfterDays}`, offset: BILLING_RULES.readOnlyAfterDays },
  { key: `J+${BILLING_RULES.suspendAfterDays}`, offset: BILLING_RULES.suspendAfterDays },
];

/**
 * Relance due aujourd'hui pour une facture ouverte, ou null. `daysFromDue` :
 * aujourd'hui − échéance (négatif avant l'échéance). Une relance manquée
 * (tâche planifiée arrêtée) est rattrapée : on envoie la plus récente due.
 */
export function reminderDue(daysFromDue: number, alreadySent: readonly string[]): string | null {
  const due = REMINDERS.filter((r) => r.offset <= daysFromDue && !alreadySent.includes(r.key));
  return due.length ? due[due.length - 1].key : null;
}

/** Statut de retard selon l'ancienneté de la plus vieille facture impayée (null : à jour). */
export function overdueStatus(daysLate: number): SaasSubscriptionStatus | null {
  if (daysLate >= BILLING_RULES.suspendAfterDays) return "SUSPENDED";
  if (daysLate >= BILLING_RULES.readOnlyAfterDays) return "READ_ONLY";
  if (daysLate >= 1) return "PAST_DUE";
  return null;
}

export const SAAS_STATUS_LABELS: Record<SaasSubscriptionStatus, string> = {
  TRIALING: "Essai gratuit",
  ACTIVE: "Actif",
  PAST_DUE: "Paiement en retard",
  READ_ONLY: "Lecture seule (impayé)",
  SUSPENDED: "Suspendu (impayé)",
  CANCELLED: "Résilié",
};

export const invoiceNumber = (seq: number) => `ZD-${String(seq).padStart(6, "0")}`;
