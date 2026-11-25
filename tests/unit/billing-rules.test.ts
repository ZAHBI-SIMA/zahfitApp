/**
 * Conditions contractuelles de l'abonnement ZAHFIT : relances et paliers de
 * retard (lecture seule, suspension). Toute modification du contrat doit
 * passer par ces tests.
 */
import { describe, expect, it } from "vitest";
import { BILLING_RULES, invoiceNumber, overdueStatus, reminderDue } from "@/modules/billing/billing.rules";

describe("Paliers de retard", () => {
  it("à jour, en retard, lecture seule, suspendu", () => {
    expect(overdueStatus(-2)).toBeNull();
    expect(overdueStatus(0)).toBeNull(); // le jour de l'échéance, on n'est pas en retard
    expect(overdueStatus(1)).toBe("PAST_DUE");
    expect(overdueStatus(BILLING_RULES.readOnlyAfterDays)).toBe("READ_ONLY");
    expect(overdueStatus(BILLING_RULES.suspendAfterDays - 1)).toBe("READ_ONLY");
    expect(overdueStatus(BILLING_RULES.suspendAfterDays)).toBe("SUSPENDED");
  });

  it("la lecture seule précède toujours la suspension", () => {
    expect(BILLING_RULES.readOnlyAfterDays).toBeLessThan(BILLING_RULES.suspendAfterDays);
  });
});

describe("Relances", () => {
  it("une seule relance par palier, la plus récente rattrapée", () => {
    expect(reminderDue(-5, [])).toBeNull();
    expect(reminderDue(-3, [])).toBe("J-3");
    expect(reminderDue(0, ["J-3"])).toBe("J0");
    expect(reminderDue(0, ["J-3", "J0"])).toBeNull();
    // tâche arrêtée plusieurs jours : on n'envoie que la relance la plus récente due
    expect(reminderDue(9, [])).toBe(`J+${BILLING_RULES.readOnlyAfterDays}`);
  });

  it("numérotation des factures", () => {
    expect(invoiceNumber(1)).toBe("ZD-000001");
    expect(invoiceNumber(1234567)).toBe("ZD-1234567");
  });
});
