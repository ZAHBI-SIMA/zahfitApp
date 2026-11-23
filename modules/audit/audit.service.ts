import type { Tx } from "@/lib/db";

/** Libellés lisibles des actions journalisées. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Connexion",
  "tenant.create": "Création de salle",
  "tenant.update": "Modification de salle",
  "tenant.suspend": "Suspension de salle",
  "tenant.reactivate": "Réactivation de salle",
  "tenant.settings.update": "Paramètres de la salle",
  "member.create": "Inscription d'un adhérent",
  "member.update": "Modification d'une fiche",
  "member.archive": "Archivage d'un adhérent",
  "member.restore": "Restauration d'un adhérent",
  "member.import": "Import d'adhérents",
  "member.badge.issue": "Remise d'un badge",
  "member.badge.renew": "Renouvellement du badge",
  "member.badge.revoke": "Révocation du badge",
  "tenant.access.update": "Réglages du contrôle d'accès",
  "staff.profile.update": "Profil employé",
  "room.create": "Ajout d'une salle de cours",
  "room.update": "Modification d'une salle de cours",
  "class_type.create": "Ajout d'un type de cours",
  "class_type.update": "Modification d'un type de cours",
  "class_series.create": "Création d'un cours régulier",
  "class_series.update": "Modification d'un cours régulier",
  "class_series.stop": "Arrêt d'un cours régulier",
  "class_session.create": "Ajout d'une séance",
  "class_session.update": "Modification d'une séance",
  "class_session.cancel": "Annulation d'une séance",
  "class_session.restore": "Rétablissement d'une séance",
  "booking.create": "Réservation d'une séance",
  "booking.cancel": "Annulation d'une réservation",
  "tenant.booking.update": "Réglages des réservations",
  "staff.invite": "Invitation d'un membre de l'équipe",
  "staff.role_change": "Changement de rôle",
  "staff.disable": "Désactivation d'un accès",
  "staff.enable": "Réactivation d'un accès",
};

export const auditLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;

/**
 * Derniers événements visibles dans le contexte courant : toute la
 * plateforme en withPlatform, la salle seule en withTenant (le RLS décide).
 */
export async function listAuditLogs(tx: Tx, limit = 100) {
  const logs = await tx.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorUserId: true,
      ipAddress: true,
      createdAt: true,
      tenant: { select: { name: true } },
    },
  });
  const actorIds = [...new Set(logs.map((l) => l.actorUserId).filter((id): id is string => !!id))];
  const actors = await tx.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(actors.map((a) => [a.id, a]));
  return logs.map((l) => ({ ...l, actor: l.actorUserId ? (byId.get(l.actorUserId) ?? null) : null }));
}
