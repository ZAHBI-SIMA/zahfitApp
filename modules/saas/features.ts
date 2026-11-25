import type { SaasFeature } from "@/lib/generated/prisma/enums";
import type { Permission } from "@/lib/rbac/permissions";

/**
 * Modules activables selon le forfait ZAHFIT. Fichier PUR (sans base ni
 * session) : partagé par les gardes, le menu, les pages et les tests.
 *
 * Le socle (adhérents, abonnements, paiements manuels, caisse, dépenses) est
 * inclus dans tous les forfaits et n'apparaît donc pas ici.
 */

export const SAAS_FEATURES = [
  "ONLINE_PAYMENTS",
  "ACCESS_CONTROL",
  "CLASSES",
  "MESSAGING",
  "ADVANCED_REPORTS",
  "SHOP",
] as const satisfies readonly SaasFeature[];

export const FEATURE_LABELS: Record<SaasFeature, string> = {
  ONLINE_PAYMENTS: "Paiement en ligne (Mobile Money)",
  ACCESS_CONTROL: "Contrôle d'accès QR Code",
  CLASSES: "Planning et réservations",
  MESSAGING: "WhatsApp et SMS",
  ADVANCED_REPORTS: "Statistiques avancées",
  SHOP: "Boutique et stocks",
};

/**
 * Permissions propres à un module : une Server Action gardée par l'une
 * d'elles est automatiquement refusée si le forfait n'inclut pas le module
 * (voir `requireActionContext`). Les permissions du socle n'y figurent pas.
 */
export const PERMISSION_FEATURE: Partial<Record<Permission, SaasFeature>> = {
  "access.scan": "ACCESS_CONTROL",
  "classes.read": "CLASSES",
  "classes.manage": "CLASSES",
  "bookings.manage": "CLASSES",
  "attendance.write": "CLASSES",
  "self.bookings": "CLASSES",
  "shop.sell": "SHOP",
  "shop.manage": "SHOP",
};

export const hasFeature = (features: readonly SaasFeature[], feature: SaasFeature | undefined) =>
  !feature || features.includes(feature);

export function featureUnavailableMessage(feature: SaasFeature, planName: string) {
  return `« ${FEATURE_LABELS[feature]} » n'est pas inclus dans votre forfait ${planName}. Contactez ZahDigit pour changer de forfait.`;
}
