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
