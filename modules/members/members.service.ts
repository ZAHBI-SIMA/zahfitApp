import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { MemberSource, MemberStatus, Prisma } from "@/lib/generated/prisma/client";
import { phoneSearchDigits } from "@/lib/phone";
import type { MemberInput } from "@/modules/members/members.schema";

export type Actor = { tenantId: string; userId: string | null };

export const PAGE_SIZE = 25;

export const memberCode = (n: number) => `ADH-${String(n).padStart(6, "0")}`;

/**
 * Réserve `count` codes consécutifs pour la salle. L'UPDATE … RETURNING
 * verrouille la ligne de la salle jusqu'à la fin de la transaction : deux
 * inscriptions simultanées ne peuvent pas obtenir le même code.
 */
export async function reserveMemberCodes(tx: Tx, tenantId: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const { memberSeq } = await tx.tenant.update({
    where: { id: tenantId },
    data: { memberSeq: { increment: count } },
    select: { memberSeq: true },
  });
  const first = memberSeq - count + 1;
  return Array.from({ length: count }, (_, i) => memberCode(first + i));
}

const hasConsent = (m: Pick<MemberInput, "consentWhatsapp" | "consentSms" | "consentEmail">) =>
  m.consentWhatsapp || m.consentSms || m.consentEmail;

/** Photo instantanée pour l'audit (pas de données superflues). */
function snapshot(m: Partial<MemberInput> & { status?: MemberStatus }): Prisma.InputJsonObject {
  return {
    firstName: m.firstName ?? null,
    lastName: m.lastName ?? null,
    phone: m.phone ?? null,
    email: m.email ?? null,
    birthDate: m.birthDate ? m.birthDate.toISOString().slice(0, 10) : null,
    consentWhatsapp: m.consentWhatsapp ?? null,
    consentSms: m.consentSms ?? null,
    consentEmail: m.consentEmail ?? null,
    status: m.status ?? null,
  };
}

async function assertPhoneAvailable(tx: Tx, tenantId: string, phone: string, exceptId?: string) {
  const existing = await tx.member.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: { id: true, code: true },
  });
  if (existing && existing.id !== exceptId) {
    throw new BusinessError(`Ce numéro est déjà utilisé par l'adhérent ${existing.code}.`, "phone");
  }
}

export async function createMember(
  tx: Tx,
  actor: Actor,
  input: MemberInput,
  source: MemberSource = "RECEPTION",
) {
  await assertPhoneAvailable(tx, actor.tenantId, input.phone);
  const [code] = await reserveMemberCodes(tx, actor.tenantId, 1);

  const member = await tx.member.create({
    data: {
      ...input,
      tenantId: actor.tenantId,
      code,
      source,
      createdById: actor.userId,
      consentUpdatedAt: hasConsent(input) ? new Date() : null,
    },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "member.create",
    entityType: "member",
    entityId: member.id,
    after: snapshot(member),
  });
  return member;
}

export async function updateMember(tx: Tx, actor: Actor, memberId: string, input: MemberInput) {
  const before = await tx.member.findUnique({ where: { id: memberId } });
  if (!before) throw new BusinessError("Adhérent introuvable.");
  if (before.status === "ARCHIVED") throw new BusinessError("Restaurez l'adhérent avant de le modifier.");
  await assertPhoneAvailable(tx, actor.tenantId, input.phone, memberId);

  const consentChanged =
    before.consentWhatsapp !== input.consentWhatsapp ||
    before.consentSms !== input.consentSms ||
    before.consentEmail !== input.consentEmail;

  const after = await tx.member.update({
    where: { id: memberId },
    data: { ...input, ...(consentChanged ? { consentUpdatedAt: new Date() } : {}) },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "member.update",
    entityType: "member",
    entityId: memberId,
    before: snapshot(before),
    after: snapshot(after),
  });
  return after;
}

export async function setMemberArchived(tx: Tx, actor: Actor, memberId: string, archived: boolean) {
  const before = await tx.member.findUnique({ where: { id: memberId }, select: { status: true } });
  if (!before) throw new BusinessError("Adhérent introuvable.");
  if (archived === (before.status === "ARCHIVED")) return;

  await tx.member.update({
    where: { id: memberId },
    data: archived ? { status: "ARCHIVED", archivedAt: new Date() } : { status: "ACTIVE", archivedAt: null },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: archived ? "member.archive" : "member.restore",
    entityType: "member",
    entityId: memberId,
    before: { status: before.status },
    after: { status: archived ? "ARCHIVED" : "ACTIVE" },
  });
}

export type MemberFilter = "actifs" | "archives" | "tous";

export function parseMemberFilter(value: string | string[] | undefined): MemberFilter {
  return value === "archives" || value === "tous" ? value : "actifs";
}

export async function searchMembers(tx: Tx, params: { q?: string; filter?: MemberFilter; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const q = params.q?.trim();
  const digits = q ? phoneSearchDigits(q) : null;

  // Pas de filtre tenant_id explicite : le RLS de la transaction l'impose.
  const where: Prisma.MemberWhereInput = {
    ...(params.filter === "archives"
      ? { status: "ARCHIVED" }
      : params.filter === "tous"
        ? {}
        : { status: { not: "ARCHIVED" } }),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            // « 0701 » doit trouver « +2250701… » : on cherche sans le 0 initial.
            ...(digits ? [{ phone: { contains: digits.replace(/^0/, "") } }] : []),
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    tx.member.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, code: true, firstName: true, lastName: true, phone: true, email: true, status: true, createdAt: true },
    }),
    tx.member.count({ where }),
  ]);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function getMember(tx: Tx, memberId: string) {
  return tx.member.findUnique({ where: { id: memberId } });
}

/** Historique des opérations sur la fiche (journal d'audit). */
export async function getMemberHistory(tx: Tx, memberId: string) {
  const logs = await tx.auditLog.findMany({
    where: { entityType: "member", entityId: memberId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, action: true, actorUserId: true, createdAt: true },
  });
  const actorIds = [...new Set(logs.map((l) => l.actorUserId).filter((id): id is string => !!id))];
  const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return logs.map((l) => ({ ...l, actorName: l.actorUserId ? (names.get(l.actorUserId) ?? "—") : "Système" }));
}
