import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";

/**
 * Assistant de démarrage d'une nouvelle salle : infos → formules →
 * adhérents → moyens de paiement → équipe.
 *
 * Une étape est « faite » d'après les DONNÉES (une formule existe, des
 * adhérents sont inscrits…), pas d'après un clic : si l'administrateur
 * crée sa formule depuis le menu plutôt que depuis l'assistant, l'étape est
 * cochée quand même. Seul « Passer » est mémorisé, pour les étapes qui
 * n'ont pas de sens pour une salle donnée (ex. pas d'équipe).
 */

export const ONBOARDING_STEPS = [
  { key: "salle", label: "Votre salle", hint: "Téléphone, adresse et horaires d'ouverture." },
  { key: "formules", label: "Formules", hint: "Au moins une formule en vente (mensuel, étudiant…)." },
  { key: "adherents", label: "Adhérents", hint: "Importez votre fichier existant ou inscrivez vos premiers adhérents." },
  { key: "encaissements", label: "Moyens de paiement", hint: "Paiement en plusieurs fois, acompte, mention des reçus." },
  { key: "equipe", label: "Équipe", hint: "Invitez la réception, les coachs, le comptable." },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export const STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key) as OnboardingStepKey[];
export const isStepKey = (v: unknown): v is OnboardingStepKey => STEP_KEYS.includes(v as OnboardingStepKey);

/** Faits observés dans la base, d'où l'on déduit l'avancement. */
export type OnboardingFacts = {
  hasContact: boolean; // téléphone et adresse renseignés
  hasOpeningHours: boolean;
  activePlans: number;
  members: number;
  /** Réglages d'encaissement modifiés par rapport aux valeurs par défaut */
  paymentSettingsCustomized: boolean;
  staff: number; // comptes du personnel, administrateur compris
};

export function stepDone(key: OnboardingStepKey, f: OnboardingFacts): boolean {
  switch (key) {
    case "salle":
      return f.hasContact && f.hasOpeningHours;
    case "formules":
      return f.activePlans > 0;
    case "adherents":
      return f.members > 0;
    case "encaissements":
      return f.paymentSettingsCustomized;
    case "equipe":
      return f.staff > 1;
  }
}

/** Avancement : chaque étape est faite, passée, ou à faire ; la suivante est la première à faire. */
export function onboardingProgress(facts: OnboardingFacts, skipped: readonly string[]) {
  const steps = ONBOARDING_STEPS.map((s) => {
    const done = stepDone(s.key, facts);
    return { ...s, done, skipped: !done && skipped.includes(s.key) };
  });
  const settled = steps.filter((s) => s.done || s.skipped).length;
  return {
    steps,
    settled,
    total: steps.length,
    next: steps.find((s) => !s.done && !s.skipped)?.key ?? null,
  };
}

/** État de l'assistant pour la salle courante (contexte de la salle). */
export async function onboardingState(tx: Tx, tenantId: string) {
  const [tenant, activePlans, members, staff] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        phone: true,
        address: true,
        openingHours: true,
        allowPartialPayment: true,
        minDepositPercent: true,
        receiptFooter: true,
        onboardingSkipped: true,
        onboardingDoneAt: true,
      },
    }),
    tx.membershipPlan.count({ where: { tenantId, isActive: true } }),
    tx.member.count({ where: { tenantId } }),
    tx.tenantMembership.count({ where: { tenantId, role: { not: "MEMBER" } } }),
  ]);
  const facts: OnboardingFacts = {
    hasContact: Boolean(tenant.phone && tenant.address),
    hasOpeningHours: tenant.openingHours !== null,
    activePlans,
    members,
    paymentSettingsCustomized:
      tenant.allowPartialPayment || tenant.minDepositPercent !== 100 || Boolean(tenant.receiptFooter),
    staff,
  };
  return { ...onboardingProgress(facts, tenant.onboardingSkipped), facts, doneAt: tenant.onboardingDoneAt };
}

export const stepSchema = z.object({
  step: z.string().refine(isStepKey, "Étape inconnue."),
});

/** Passe une étape (contexte de la salle). */
export async function skipOnboardingStep(tx: Tx, actor: { tenantId: string; userId: string }, step: OnboardingStepKey) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { onboardingSkipped: true } });
  if (tenant.onboardingSkipped.includes(step)) return;
  await tx.tenant.update({ where: { id: actor.tenantId }, data: { onboardingSkipped: { push: step } } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.onboarding.skip",
    entityType: "tenant",
    entityId: actor.tenantId,
    after: { step },
  });
}

/**
 * Termine l'assistant. Toutes les étapes doivent être faites ou passées,
 * et une formule doit exister : une salle sans formule ne peut rien vendre,
 * on ne la laisse pas croire qu'elle est prête.
 */
export async function finishOnboarding(tx: Tx, actor: { tenantId: string; userId: string }) {
  const state = await onboardingState(tx, actor.tenantId);
  if (state.doneAt) return;
  if (!state.steps.find((s) => s.key === "formules")?.done) {
    throw new BusinessError("Créez au moins une formule avant de terminer : sans formule, aucun abonnement ne peut être vendu.");
  }
  if (state.next) {
    const label = ONBOARDING_STEPS.find((s) => s.key === state.next)!.label;
    throw new BusinessError(`Terminez ou passez l'étape « ${label} » d'abord.`);
  }
  await tx.tenant.update({ where: { id: actor.tenantId }, data: { onboardingDoneAt: new Date() } });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "tenant.onboarding.finish",
    entityType: "tenant",
    entityId: actor.tenantId,
  });
}
