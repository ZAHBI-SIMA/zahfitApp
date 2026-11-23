import type { TenantRole } from "@/lib/generated/prisma/enums";

/**
 * Catalogue des permissions ZAHFIT (section 4 du cahier des charges).
 * Format : "<domaine>.<action>". Ajouter ici toute nouvelle permission :
 * le type `Permission` empêche ensuite toute faute de frappe dans le code.
 */
export const PERMISSIONS = [
  // Établissement
  "dashboard.view",
  "tenant.settings.manage", // infos, horaires, photos de la salle
  "billing.settings.manage", // moyens de paiement, numérotation des reçus
  "staff.manage", // comptes du personnel et rôles
  "audit.read",
  // Adhérents & abonnements
  "members.read",
  "members.write",
  "members.archive",
  "plans.manage", // formules et tarifs
  "subscriptions.read",
  "subscriptions.write",
  // Argent
  "payments.read",
  "payments.collect", // encaisser à l'accueil
  "payments.refund",
  "finance.reports.read", // CA, exports comptables
  "expenses.manage",
  "cash.manage", // ouverture / clôture de caisse
  // Exploitation
  "access.scan", // contrôle d'accès QR
  "classes.read",
  "classes.manage", // créer / modifier des cours
  "bookings.manage", // réserver / annuler pour un adhérent (accueil)
  "attendance.write", // pointer les présences
  // Espace adhérent (ses propres données uniquement)
  "self.profile",
  "self.subscription",
  "self.payments",
  "self.bookings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions touchant à l'argent : utilisées par les tests de sécurité. */
export const FINANCIAL_PERMISSIONS = [
  "billing.settings.manage",
  "payments.read",
  "payments.collect",
  "payments.refund",
  "finance.reports.read",
  "expenses.manage",
  "cash.manage",
] as const satisfies readonly Permission[];

const SELF_PERMISSIONS = PERMISSIONS.filter((p) => p.startsWith("self."));
const ALL_STAFF_PERMISSIONS = PERMISSIONS.filter((p) => !p.startsWith("self."));

/**
 * Matrice rôle → permissions.
 * Règles du cahier des charges à respecter :
 *  - Un coach ne doit pas accéder aux informations financières.
 *  - Un réceptionniste ne doit pas modifier les paramètres de facturation.
 * (vérifiées automatiquement par tests/unit/rbac.test.ts)
 */
export const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  ADMIN: ALL_STAFF_PERMISSIONS,
  MEMBER: SELF_PERMISSIONS,

  /**
   * Gérant : « gestion commerciale et financière ». Tout l'opérationnel,
   * remboursements compris (→ 2FA obligatoire), mais ni le personnel ni les
   * paramètres de facturation, réservés au propriétaire (ADMIN).
   */
  MANAGER: [
    "dashboard.view",
    "tenant.settings.manage",
    "audit.read",
    "members.read",
    "members.write",
    "members.archive",
    "plans.manage",
    "subscriptions.read",
    "subscriptions.write",
    "payments.read",
    "payments.collect",
    "payments.refund",
    "finance.reports.read",
    "expenses.manage",
    "cash.manage",
    "access.scan",
    "classes.read",
    "classes.manage",
    "bookings.manage",
    "attendance.write",
  ],

  /**
   * Réceptionniste : « adhérents, paiements, inscriptions et accès ».
   * Encaisse et consulte l'historique d'un adhérent au comptoir, mais ne
   * rembourse pas, n'archive pas et ne voit pas les rapports financiers.
   */
  RECEPTIONIST: [
    "members.read",
    "members.write",
    "subscriptions.read",
    "subscriptions.write",
    "payments.read",
    "payments.collect",
    "access.scan",
    "classes.read",
    "bookings.manage",
  ],

  /**
   * Coach : « planning, cours et présences ». Pas de `members.read` :
   * il voit ses participants via ses cours, pas l'annuaire complet
   * (téléphones, e-mails) — minimisation des données personnelles.
   */
  COACH: ["classes.read", "attendance.write"],

  /**
   * Comptable : « recettes, dépenses et rapports ». Lecture des adhérents
   * (noms sur les reçus) et du journal d'audit, gestion de caisse, mais
   * aucun encaissement ni remboursement : il contrôle, il n'opère pas.
   */
  ACCOUNTANT: [
    "dashboard.view",
    "audit.read",
    "members.read",
    "subscriptions.read",
    "payments.read",
    "finance.reports.read",
    "expenses.manage",
    "cash.manage",
  ],
};

export function can(role: TenantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Rôles dont le compte est « sensible » au sens de la section 9 :
 * 2FA obligatoire. Déduit de la matrice : quiconque peut gérer le personnel,
 * la facturation ou rembourser de l'argent.
 */
export function requiresTwoFactor(role: TenantRole): boolean {
  return (
    can(role, "staff.manage") ||
    can(role, "billing.settings.manage") ||
    can(role, "payments.refund")
  );
}
