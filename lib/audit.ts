import type { Prisma } from "@/lib/generated/prisma/client";
import type { Tx } from "@/lib/db";

/**
 * Journal des opérations sensibles (section 4 : « Les opérations sensibles
 * doivent être historisées »).
 *
 * Toujours appelé avec la transaction `tx` de l'opération auditée : si
 * l'opération échoue, la ligne d'audit est annulée avec elle, et inversement.
 */
export type AuditEntry = {
  tenantId?: string | null;
  actorUserId?: string | null;
  /** Format `<domaine>.<verbe>` : "auth.login", "tenant.suspend", "payment.refund"… */
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function audit(tx: Tx, entry: AuditEntry) {
  // createMany et non create : `create` génère un INSERT … RETURNING, et
  // PostgreSQL applique alors AUSSI la politique SELECT à la ligne renvoyée.
  // Un événement plateforme (tenant_id NULL) n'étant lisible que par le
  // Super Admin, l'INSERT serait rejeté. Un journal en ajout seul n'a
  // jamais besoin de relire ce qu'il vient d'écrire.
  await tx.auditLog.createMany({
    data: {
      tenantId: entry.tenantId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
