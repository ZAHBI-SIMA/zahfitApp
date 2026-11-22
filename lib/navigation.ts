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
  | "user";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Masqué si le rôle n'a pas cette permission. */
  permission?: Permission;
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
    { href: "/super-admin/forfaits", label: "Forfaits SaaS", icon: "card", plannedSprint: 12 },
    { href: "/super-admin/audit", label: "Journal d'audit", icon: "shield" },
  ],
  admin: [
    { href: "/admin", label: "Tableau de bord", icon: "dashboard", permission: "dashboard.view" },
    { href: "/admin/adherents", label: "Adhérents", icon: "users", permission: "members.read" },
    { href: "/admin/formules", label: "Formules", icon: "card", permission: "plans.manage", plannedSprint: 3 },
    { href: "/admin/paiements", label: "Paiements", icon: "wallet", permission: "payments.read", plannedSprint: 4 },
    { href: "/admin/statistiques", label: "Statistiques", icon: "chart", permission: "finance.reports.read", plannedSprint: 5 },
    { href: "/admin/equipe", label: "Équipe", icon: "shield", permission: "staff.manage" },
    { href: "/admin/parametres", label: "Paramètres", icon: "settings", permission: "tenant.settings.manage" },
  ],
  reception: [
    { href: "/reception", label: "Accueil", icon: "dashboard" },
    { href: "/reception/adherents", label: "Adhérents", icon: "users", permission: "members.read" },
    { href: "/reception/scan", label: "Contrôle d'accès", icon: "qr", permission: "access.scan", plannedSprint: 6 },
    { href: "/reception/encaisser", label: "Encaisser", icon: "wallet", permission: "payments.collect", plannedSprint: 4 },
  ],
  coach: [
    { href: "/coach", label: "Mes cours", icon: "calendar" },
    { href: "/coach/presences", label: "Présences", icon: "users", permission: "attendance.write", plannedSprint: 8 },
  ],
  member: [
    { href: "/member", label: "Mon abonnement", icon: "card" },
    { href: "/member/qr", label: "Mon QR Code", icon: "qr", plannedSprint: 6 },
    { href: "/member/reservations", label: "Réservations", icon: "calendar", plannedSprint: 8 },
    { href: "/member/profil", label: "Mon profil", icon: "user", plannedSprint: 2 },
  ],
};
