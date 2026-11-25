/**
 * Forfaits : la correspondance permission → module ne doit jamais retirer le
 * SOCLE (adhérents, abonnements, paiements manuels, caisse) à une salle.
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  FEATURE_LABELS,
  PERMISSION_FEATURE,
  SAAS_FEATURES,
  featureUnavailableMessage,
  hasFeature,
} from "@/modules/saas/features";
import { usageRatio } from "@/modules/saas/saas.service";

describe("Modules du forfait", () => {
  it("le socle n'est rattaché à aucun module payant", () => {
    const core = [
      "members.read",
      "members.write",
      "subscriptions.read",
      "subscriptions.write",
      "payments.read",
      "payments.collect",
      "cash.operate",
      "expenses.manage",
      "finance.reports.read",
      "staff.manage",
    ] as const;
    for (const p of core) expect(PERMISSION_FEATURE[p], p).toBeUndefined();
  });

  it("chaque permission rattachée existe et chaque module a un libellé", () => {
    for (const p of Object.keys(PERMISSION_FEATURE)) expect(PERMISSIONS).toContain(p);
    for (const f of SAAS_FEATURES) expect(FEATURE_LABELS[f]).toBeTruthy();
  });

  it("hasFeature : sans module requis, toujours accessible", () => {
    expect(hasFeature([], undefined)).toBe(true);
    expect(hasFeature([], "SHOP")).toBe(false);
    expect(hasFeature(["SHOP"], "SHOP")).toBe(true);
    expect(featureUnavailableMessage("SHOP", "Starter")).toMatch(/Boutique et stocks.*Starter/);
  });

  it("usageRatio : illimité, plafonné à 100 %", () => {
    expect(usageRatio(5, null)).toBeNull();
    expect(usageRatio(0, 0)).toBe(100);
    expect(usageRatio(120, 100)).toBe(100);
    expect(usageRatio(40, 50)).toBe(80);
  });
});
