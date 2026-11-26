/**
 * Règles du support et de l'assistant de démarrage (Sprint 14).
 * Les mêmes garanties sont reprises par la base : ces tests documentent le
 * comportement attendu côté interface.
 */
import { describe, expect, it } from "vitest";
import { onboardingProgress, type OnboardingFacts } from "@/modules/onboarding/onboarding.service";
import {
  SUPPORT_ACCESS_RULES,
  statusAfterTenantReply,
  supportAccessActive,
  supportAccessEnd,
  tenantCanSetStatus,
} from "@/modules/support/support.rules";

describe("Statuts des tickets", () => {
  it("une réponse de la salle remet dans la file ZahDigit un ticket qui l'attendait", () => {
    expect(statusAfterTenantReply("WAITING_CUSTOMER")).toBe("OPEN");
    expect(statusAfterTenantReply("RESOLVED")).toBe("OPEN");
    expect(statusAfterTenantReply("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(statusAfterTenantReply("OPEN")).toBe("OPEN");
  });

  it("la salle peut clore, ou rouvrir ce qui attend sa réponse ; jamais rouvrir un ticket clos", () => {
    expect(tenantCanSetStatus("OPEN", "CLOSED")).toBe(true);
    expect(tenantCanSetStatus("RESOLVED", "OPEN")).toBe(true);
    expect(tenantCanSetStatus("IN_PROGRESS", "OPEN")).toBe(false);
    expect(tenantCanSetStatus("OPEN", "RESOLVED")).toBe(false);
    expect(tenantCanSetStatus("CLOSED", "OPEN")).toBe(false);
  });
});

describe("Accès du support", () => {
  const start = new Date("2027-03-01T10:00:00Z");
  const expiresAt = new Date("2027-03-01T11:00:00Z");

  it("en cours tant qu'il n'est ni terminé ni expiré", () => {
    expect(supportAccessActive({ endedAt: null, expiresAt }, start)).toBe(true);
    expect(supportAccessActive({ endedAt: null, expiresAt }, expiresAt)).toBe(false);
    expect(supportAccessActive({ endedAt: start, expiresAt }, start)).toBe(false);
  });

  it("fin effective : la clôture manuelle si elle précède l'expiration", () => {
    const ended = new Date("2027-03-01T10:20:00Z");
    expect(supportAccessEnd({ endedAt: ended, expiresAt })).toEqual(ended);
    expect(supportAccessEnd({ endedAt: null, expiresAt })).toEqual(expiresAt);
  });

  it("jamais l'espace d'un adhérent, 2 heures au plus (comme la contrainte SQL)", () => {
    expect(SUPPORT_ACCESS_RULES.allowedRoles).not.toContain("MEMBER");
    expect(Math.max(...SUPPORT_ACCESS_RULES.durations)).toBeLessThanOrEqual(120);
  });
});

describe("Assistant de démarrage", () => {
  const empty: OnboardingFacts = {
    hasContact: false,
    hasOpeningHours: false,
    activePlans: 0,
    members: 0,
    paymentSettingsCustomized: false,
    staff: 1,
  };

  it("nouvelle salle : rien de fait, on commence par la salle", () => {
    const p = onboardingProgress(empty, []);
    expect(p.settled).toBe(0);
    expect(p.next).toBe("salle");
  });

  it("avancement déduit des données, étapes passées mémorisées", () => {
    const p = onboardingProgress({ ...empty, hasContact: true, hasOpeningHours: true, activePlans: 2 }, ["adherents"]);
    expect(p.steps.map((s) => [s.key, s.done, s.skipped])).toEqual([
      ["salle", true, false],
      ["formules", true, false],
      ["adherents", false, true],
      ["encaissements", false, false],
      ["equipe", false, false],
    ]);
    expect(p.settled).toBe(3);
    expect(p.next).toBe("encaissements");
  });

  it("l'équipe compte au-delà de l'administrateur", () => {
    expect(onboardingProgress({ ...empty, staff: 1 }, []).steps.at(-1)?.done).toBe(false);
    expect(onboardingProgress({ ...empty, staff: 2 }, []).steps.at(-1)?.done).toBe(true);
  });
});
