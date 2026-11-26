import type { SaasFeature } from "@/lib/generated/prisma/enums";
import type { Permission } from "@/lib/rbac/permissions";
import type { Space } from "@/lib/rbac/spaces";

export type IconName =
  | "dashboard"
  | "building"
  | "users"
  | "card"
  | "wallet"
  | "qr"
  | "calendar"
  | "chart"
  | "settings"
  | "shield"
  | "user"
  | "bell"
  | "help";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Masqué si le rôle n'a pas cette permission. */
  permission?: Permission;
  /** Module du forfait requis (sinon déduit de la permission) : l'entrée est masquée s'il manque. */
  feature?: SaasFeature;
  /** Sprint prévu : l'entrée est affichée, désactivée, avec un badge « bientôt ». */
  plannedSprint?: number;
};

/**
 * Menus des espaces. Les entrées `plannedSprint` matérialisent la roadmap
 * pour la salle pilote ; elles deviendront actives au fil des sprints.
 */
export const NAVIGATION: Record<Space, NavItem[]> = {
  "super-admin": [
    { href: "/super-admin", label: "Tableau de bord", icon: "dashboard" },
    { href: "/super-admin/salles", label: "Salles clientes", icon: "building" },
    { href: "/super-admin/forfaits", label: "Forfaits SaaS", icon: "card" },
    { href: "/super-admin/facturation", label: "Facturation", icon: "wallet" },
    { href: "/super-admin/support", label: "Support", icon: "help" },
    { href: "/super-admin/audit", label: "Journal d'audit", icon: "shield" },
  ],
  admin: [
    { href: "/admin", label: "Tableau de bord", icon: "dashboard", permission: "dashboard.view" },
    { href: "/admin/adherents", label: "Adhérents", icon: "users", permission: "members.read" },
    { href: "/admin/abonnements", label: "Abonnements", icon: "calendar", permission: "subscriptions.read" },
    { href: "/admin/formules", label: "Formules", icon: "card", permission: "plans.manage" },
    { href: "/admin/paiements", label: "Paiements", icon: "wallet", permission: "payments.read" },
    { href: "/admin/caisse", label: "Caisse", icon: "wallet", permission: "finance.reports.read" },
    { href: "/admin/depenses", label: "Dépenses", icon: "card", permission: "expenses.manage" },
    { href: "/admin/planning", label: "Planning", icon: "calendar", permission: "classes.read" },
    { href: "/admin/acces", label: "Fréquentation", icon: "qr", permission: "access.scan" },
    { href: "/admin/messages", label: "Messages", icon: "bell", permission: "tenant.settings.manage", feature: "MESSAGING" },
    { href: "/admin/boutique", label: "Boutique", icon: "card", permission: "finance.reports.read", feature: "SHOP" },
    { href: "/admin/statistiques", label: "Statistiques", icon: "chart", permission: "finance.reports.read", feature: "ADVANCED_REPORTS" },
    { href: "/admin/equipe", label: "Équipe", icon: "shield", permission: "staff.manage" },
    { href: "/admin/forfait", label: "Mon forfait", icon: "shield", permission: "tenant.settings.manage" },
    { href: "/admin/facturation", label: "Abonnement ZAHFIT", icon: "wallet", permission: "billing.settings.manage" },
    { href: "/admin/parametres", label: "Paramètres", icon: "settings", permission: "tenant.settings.manage" },
    { href: "/admin/support", label: "Support", icon: "help", permission: "support.use" },
  ],
  reception: [
    { href: "/reception", label: "Accueil", icon: "dashboard" },
    { href: "/reception/adherents", label: "Adhérents", icon: "users", permission: "members.read" },
    { href: "/reception/abonnements", label: "Abonnements", icon: "calendar", permission: "subscriptions.read" },
    { href: "/reception/scan", label: "Contrôle d'accès", icon: "qr", permission: "access.scan" },
    { href: "/reception/planning", label: "Planning", icon: "calendar", permission: "classes.read" },
    { href: "/reception/encaisser", label: "Encaisser", icon: "wallet", permission: "payments.collect" },
    { href: "/reception/boutique", label: "Boutique", icon: "card", permission: "shop.sell" },
    { href: "/reception/caisse", label: "Caisse", icon: "wallet", permission: "cash.operate" },
  ],
  coach: [
    { href: "/coach", label: "Mes cours", icon: "calendar", feature: "CLASSES" },
    { href: "/coach/planning", label: "Planning", icon: "calendar", feature: "CLASSES" },
    { href: "/coach/profil", label: "Mon profil", icon: "user" },
  ],
  member: [
    { href: "/member", label: "Mon abonnement", icon: "card" },
    { href: "/member/qr", label: "Mon QR Code", icon: "qr", feature: "ACCESS_CONTROL" },
    { href: "/member/reservations", label: "Réservations", icon: "calendar", feature: "CLASSES" },
    { href: "/member/notifications", label: "Notifications", icon: "bell" },
    { href: "/member/historique", label: "Historique", icon: "calendar" },
    { href: "/member/profil", label: "Mon profil", icon: "user" },
  ],
};
