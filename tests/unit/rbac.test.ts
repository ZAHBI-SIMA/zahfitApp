/**
 * Règles de la section 4 du cahier des charges, traduites en tests.
 * Si la matrice de lib/rbac/permissions.ts les viole, la CI échoue.
 */
import { describe, expect, it } from "vitest";
import {
  FINANCIAL_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  requiresTwoFactor,
} from "@/lib/rbac/permissions";
import { canAccessSpace, homeSpaceFor } from "@/lib/rbac/spaces";
import type { TenantRole } from "@/lib/generated/prisma/enums";

const STAFF_ROLES: TenantRole[] = ["ADMIN", "MANAGER", "RECEPTIONIST", "COACH", "ACCOUNTANT"];

describe("Règles de sécurité du cahier des charges", () => {
  it("un coach n'accède à aucune information financière", () => {
    for (const p of FINANCIAL_PERMISSIONS) expect(can("COACH", p), p).toBe(false);
  });

  it("un réceptionniste ne modifie pas les paramètres de facturation", () => {
    expect(can("RECEPTIONIST", "billing.settings.manage")).toBe(false);
  });
});

describe("Périmètre de chaque rôle (section 4)", () => {
  it("réceptionniste : adhérents, paiements, inscriptions et accès", () => {
    for (const p of ["members.read", "members.write", "payments.collect", "access.scan"] as const) {
      expect(can("RECEPTIONIST", p), p).toBe(true);
    }
  });

  it("coach : planning, cours et présences", () => {
    for (const p of ["classes.read", "attendance.write"] as const) expect(can("COACH", p), p).toBe(true);
  });

  it("comptable : recettes, dépenses et rapports", () => {
    for (const p of ["payments.read", "finance.reports.read", "expenses.manage"] as const) {
      expect(can("ACCOUNTANT", p), p).toBe(true);
    }
    expect(can("ACCOUNTANT", "access.scan")).toBe(false);
  });

  it("gérant : gestion commerciale et financière", () => {
    for (const p of ["plans.manage", "payments.read", "finance.reports.read"] as const) {
      expect(can("MANAGER", p), p).toBe(true);
    }
  });

  it("chaque membre du personnel accède à au moins un espace", () => {
    for (const role of STAFF_ROLES) expect(homeSpaceFor(role), role).not.toBeNull();
  });
});

describe("Cohérence de la matrice", () => {
  it("seul l'administrateur gère le personnel", () => {
    for (const role of STAFF_ROLES.filter((r) => r !== "ADMIN")) {
      expect(can(role, "staff.manage"), role).toBe(false);
    }
  });

  it("le personnel n'a pas les permissions « self.* » réservées aux adhérents", () => {
    for (const role of STAFF_ROLES) {
      expect(ROLE_PERMISSIONS[role].filter((p) => p.startsWith("self.")), role).toEqual([]);
    }
  });

  it("un adhérent n'a que des permissions « self.* » et seulement l'espace adhérent", () => {
    expect(ROLE_PERMISSIONS.MEMBER.every((p) => p.startsWith("self."))).toBe(true);
    expect(canAccessSpace("MEMBER", "admin")).toBe(false);
    expect(homeSpaceFor("MEMBER")).toBe("member");
  });

  it("aucune permission en double ni inconnue", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as TenantRole[]) {
      const perms = ROLE_PERMISSIONS[role];
      expect(new Set(perms).size, role).toBe(perms.length);
      for (const p of perms) expect(PERMISSIONS, `${role}:${p}`).toContain(p);
    }
  });

  it("la 2FA est exigée pour l'administrateur, pas pour l'adhérent ni le coach", () => {
    expect(requiresTwoFactor("ADMIN")).toBe(true);
    expect(requiresTwoFactor("MEMBER")).toBe(false);
    expect(requiresTwoFactor("COACH")).toBe(false);
  });
});
