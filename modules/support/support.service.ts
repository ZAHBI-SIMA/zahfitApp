import * as z from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { SupportTicketStatus } from "@/lib/generated/prisma/enums";
import type { sendMail } from "@/lib/mail";
import { ROLE_LABELS } from "@/lib/labels";
import { checkbox, requiredText } from "@/lib/validation";
import { adminEmails } from "@/modules/billing/billing.service";
import { userNames } from "@/modules/cash/cash.service";
import {
  DEFAULT_STATUS_AFTER_PLATFORM_REPLY,
  PLATFORM_TICKET_FILTERS,
  SUPPORT_ACCESS_RULES,
  TICKET_STATUS_LABELS,
  statusAfterTenantReply,
  supportAccessActive,
  tenantCanSetStatus,
  ticketRef,
  type PlatformTicketFilter,
} from "@/modules/support/support.rules";

/**
 * Support ZahDigit : tickets salle → ZahDigit et accès du support à
 * l'espace d'une salle. Les fonctions « tenant » s'exécutent dans le
 * contexte de la salle (withTenant), les fonctions « platform » en
 * contexte plateforme (withPlatform) ; le RLS refuse toute inversion.
 *
 * Les e-mails sont RENVOYÉS, pas envoyés : l'action les expédie après la
 * transaction (un e-mail ne s'annule pas si la transaction échoue).
 */

type Mail = Parameters<typeof sendMail>[0];
type TenantActor = { tenantId: string; userId: string };

const appUrl = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3100").replace(/\/$/, "");
/** Boîte de l'équipe support ZahDigit ; absente (développement) : pas d'avis à l'équipe. */
const supportInbox = () => process.env.SUPPORT_EMAIL?.trim() || null;

function mail(to: string, subject: string, lines: string[], link: { href: string; label: string }): Mail {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return {
    to,
    subject,
    text: [...lines, `${link.label} : ${link.href}`].join("\n\n"),
    html: `${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${link.href}">${esc(link.label)}</a></p>`,
  };
}

const excerpt = (text: string) => (text.length > 600 ? `${text.slice(0, 600)}…` : text);

// --- Schémas -------------------------------------------------------------------------

const messageBody = (label = "Le message") => requiredText(label, 5000);
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const newTicketSchema = z.object({
  subject: requiredText("L'objet", 160).refine((v) => v.length >= 3, "L'objet : 3 caractères minimum."),
  category: z.enum(["TECHNICAL", "BILLING", "ACCOUNT", "FEATURE_REQUEST", "OTHER"], { error: "Choisissez un thème." }),
  priority: z.enum(PRIORITIES, { error: "Choisissez une priorité." }).default("NORMAL"),
  body: messageBody("La description"),
});

export const tenantReplySchema = z.object({ ticketId: z.uuid(), body: messageBody() });

export const platformReplySchema = z.object({
  ticketId: z.uuid(),
  body: messageBody(),
  internal: checkbox,
  /** Vide : statut par défaut (réponse publique → réponse attendue ; note → inchangé). */
  status: z.enum(STATUSES).optional().or(z.literal("").transform(() => undefined)),
});

export const platformTicketUpdateSchema = z.object({
  ticketId: z.uuid(),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  assignToMe: checkbox,
});

export const startSupportAccessSchema = z.object({
  tenantId: z.uuid(),
  targetUserId: requiredText("Le compte", 64),
  reason: requiredText("Le motif", 300).refine((v) => v.length >= 10, "Motif : 10 caractères minimum, il est montré à la salle."),
  minutes: z.coerce
    .number()
    .int()
    .refine((m) => (SUPPORT_ACCESS_RULES.durations as readonly number[]).includes(m), "Durée invalide."),
  ticketId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
});

// --- Historique (statuts) ------------------------------------------------------------

async function recordStatusChange(
  tx: Tx,
  ticket: { id: string; tenantId: string; status: SupportTicketStatus },
  to: SupportTicketStatus,
  by: { authorId: string; fromPlatform: boolean },
  now: Date,
) {
  if (ticket.status === to) return;
  // La trace AVANT le changement : une fois le ticket clos, la base refuse
  // tout nouveau message (déclencheur support_messages_insert_guard).
  await tx.supportTicketMessage.create({
    data: {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorId: by.authorId,
      fromPlatform: by.fromPlatform,
      kind: "STATUS_CHANGE",
      body: `${TICKET_STATUS_LABELS[ticket.status]} → ${TICKET_STATUS_LABELS[to]}`,
      statusFrom: ticket.status,
      statusTo: to,
    },
  });
  await tx.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: to,
      lastActivityAt: now,
      closedAt: to === "CLOSED" ? now : null,
      ...(by.fromPlatform && to === "RESOLVED" ? { resolvedAt: now } : {}),
    },
  });
}

// --- Côté salle ----------------------------------------------------------------------

/** Ouvre un ticket et son premier message (contexte de la salle). */
export async function createTicket(tx: Tx, actor: TenantActor, input: z.infer<typeof newTicketSchema>) {
  const ticket = await tx.supportTicket.create({
    data: {
      tenantId: actor.tenantId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      createdById: actor.userId,
    },
  });
  await tx.supportTicketMessage.create({
    data: { tenantId: actor.tenantId, ticketId: ticket.id, authorId: actor.userId, fromPlatform: false, body: input.body },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "support_ticket.create",
    entityType: "support_ticket",
    entityId: ticket.id,
    after: { number: ticket.number, category: input.category, priority: input.priority },
  });

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true } });
  const inbox = supportInbox();
  const mails = inbox
    ? [
        mail(
          inbox,
          `[ZAHFIT ${ticketRef(ticket.number)}] ${tenant.name} — ${input.subject}`,
          [`Nouveau ticket de ${tenant.name} (priorité : ${input.priority}).`, excerpt(input.body)],
          { href: `${appUrl()}/super-admin/support/${ticket.id}`, label: "Traiter le ticket" },
        ),
      ]
    : [];
  return { ticket, mails };
}

async function tenantTicket(tx: Tx, actor: TenantActor, ticketId: string) {
  // Contexte de la salle : le RLS ne renvoie que ses propres tickets.
  const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, tenantId: actor.tenantId } });
  if (!ticket) throw new BusinessError("Ticket introuvable.");
  if (ticket.status === "CLOSED") throw new BusinessError("Ce ticket est clos : ouvrez-en un nouveau si besoin.");
  return ticket;
}

/** Réponse de la salle : le ticket revient dans la file de ZahDigit s'il attendait la salle. */
export async function replyAsTenant(tx: Tx, actor: TenantActor, input: z.infer<typeof tenantReplySchema>, now = new Date()) {
  const ticket = await tenantTicket(tx, actor, input.ticketId);
  await tx.supportTicketMessage.create({
    data: { tenantId: actor.tenantId, ticketId: ticket.id, authorId: actor.userId, fromPlatform: false, body: input.body },
  });
  const next = statusAfterTenantReply(ticket.status);
  if (next !== ticket.status) {
    await recordStatusChange(tx, ticket, next, { authorId: actor.userId, fromPlatform: false }, now);
  } else {
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { lastActivityAt: now } });
  }
  const inbox = supportInbox();
  return {
    mails: inbox
      ? [
          mail(inbox, `[ZAHFIT ${ticketRef(ticket.number)}] Nouvelle réponse — ${ticket.subject}`, [excerpt(input.body)], {
            href: `${appUrl()}/super-admin/support/${ticket.id}`,
            label: "Voir le ticket",
          }),
        ]
      : [],
  };
}

/** La salle clôt son ticket (problème réglé, ou demande retirée). */
export async function closeTicketAsTenant(tx: Tx, actor: TenantActor, ticketId: string, now = new Date()) {
  const ticket = await tenantTicket(tx, actor, ticketId);
  if (!tenantCanSetStatus(ticket.status, "CLOSED")) throw new BusinessError("Ce ticket ne peut pas être clos.");
  await recordStatusChange(tx, ticket, "CLOSED", { authorId: actor.userId, fromPlatform: false }, now);
  await audit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "support_ticket.close",
    entityType: "support_ticket",
    entityId: ticket.id,
  });
}

// --- Côté ZahDigit ---------------------------------------------------------------------

async function platformTicket(tx: Tx, ticketId: string) {
  const ticket = await tx.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new BusinessError("Ticket introuvable.");
  if (ticket.status === "CLOSED") throw new BusinessError("Ce ticket est clos.");
  return ticket;
}

/**
 * Réponse de ZahDigit (contexte plateforme). Une note interne n'est jamais
 * montrée à la salle ni notifiée ; une réponse publique compte comme
 * première réponse et attribue le ticket à son auteur s'il est libre.
 */
export async function replyAsPlatform(
  tx: Tx,
  actorId: string,
  input: z.infer<typeof platformReplySchema>,
  now = new Date(),
) {
  const ticket = await platformTicket(tx, input.ticketId);
  await tx.supportTicketMessage.create({
    data: {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorId: actorId,
      fromPlatform: true,
      kind: input.internal ? "INTERNAL_NOTE" : "MESSAGE",
      body: input.body,
    },
  });
  await tx.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastActivityAt: now,
      ...(input.internal ? {} : { firstResponseAt: ticket.firstResponseAt ?? now }),
      ...(ticket.assignedToId ? {} : { assignedToId: actorId }),
    },
  });
  const next = input.status ?? (input.internal ? ticket.status : DEFAULT_STATUS_AFTER_PLATFORM_REPLY);
  await recordStatusChange(tx, ticket, next, { authorId: actorId, fromPlatform: true }, now);

  if (input.internal) return { mails: [] };
  const author = await tx.user.findUnique({ where: { id: ticket.createdById }, select: { email: true } });
  return {
    mails: author
      ? [
          mail(
            author.email,
            `Réponse du support ZahDigit — ticket ${ticketRef(ticket.number)}`,
            [`Le support ZahDigit a répondu à votre ticket « ${ticket.subject} » :`, excerpt(input.body)],
            { href: `${appUrl()}/admin/support/${ticket.id}`, label: "Voir et répondre" },
          ),
        ]
      : [],
  };
}

/** Priorité, statut, prise en charge (contexte plateforme). */
export async function updateTicketAsPlatform(
  tx: Tx,
  actorId: string,
  input: z.infer<typeof platformTicketUpdateSchema>,
  now = new Date(),
) {
  const ticket = await platformTicket(tx, input.ticketId);
  await tx.supportTicket.update({
    where: { id: ticket.id },
    data: {
      priority: input.priority,
      ...(input.assignToMe ? { assignedToId: actorId } : {}),
    },
  });
  await recordStatusChange(tx, ticket, input.status, { authorId: actorId, fromPlatform: true }, now);
}

// --- Lectures ----------------------------------------------------------------------------

/** Tickets de la salle courante (contexte de la salle), les plus récents d'abord. */
export async function listTenantTickets(tx: Tx) {
  return tx.supportTicket.findMany({
    orderBy: [{ lastActivityAt: "desc" }],
    take: 100,
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      priority: true,
      status: true,
      lastActivityAt: true,
      createdAt: true,
    },
  });
}

/**
 * Un ticket et son fil. En contexte de salle, les notes internes sont
 * absentes du résultat : c'est le RLS qui les retire, pas ce code.
 */
export async function loadTicket(tx: Tx, ticketId: string) {
  const ticket = await tx.supportTicket.findUnique({
    where: { id: ticketId },
    include: { tenant: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return null;
  const name = await userNames(tx, [ticket.createdById, ticket.assignedToId, ...ticket.messages.map((m) => m.authorId)]);
  return {
    ...ticket,
    createdByName: name(ticket.createdById),
    assignedToName: ticket.assignedToId ? name(ticket.assignedToId) : null,
    messages: ticket.messages.map((m) => ({ ...m, authorName: name(m.authorId) })),
  };
}

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

/** File de ZahDigit (contexte plateforme) : « à traiter » trié par urgence puis ancienneté. */
export async function listPlatformTickets(tx: Tx, filter: PlatformTicketFilter) {
  const statuses = filter === "tous" ? undefined : [...PLATFORM_TICKET_FILTERS[filter]];
  const tickets = await tx.supportTicket.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    orderBy: filter === "a-traiter" ? { lastActivityAt: "asc" } : { lastActivityAt: "desc" },
    take: 200,
    include: { tenant: { select: { name: true } } },
  });
  // Tri par urgence en mémoire : l'ordre de l'énumération SQL n'est pas celui de l'urgence.
  if (filter === "a-traiter") tickets.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const name = await userNames(tx, tickets.map((t) => t.assignedToId));
  return tickets.map((t) => ({ ...t, assignedToName: t.assignedToId ? name(t.assignedToId) : null }));
}

/** Indicateurs du support pour le tableau de bord ZahDigit. */
export async function supportKpis(tx: Tx, now = new Date()) {
  const [toHandle, urgent, waiting, answered] = await Promise.all([
    tx.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    tx.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, priority: "URGENT" } }),
    tx.supportTicket.count({ where: { status: "WAITING_CUSTOMER" } }),
    tx.supportTicket.findMany({
      where: { firstResponseAt: { not: null }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      select: { createdAt: true, firstResponseAt: true },
    }),
  ]);
  const hours = answered.map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 3_600_000);
  return {
    toHandle,
    urgent,
    waiting,
    /** Délai moyen de première réponse sur 30 jours (heures), null sans donnée. */
    firstResponseHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
  };
}

// --- Accès du support (« se connecter en tant que ») -------------------------------------

/**
 * Ouvre un accès en LECTURE SEULE à l'espace d'un membre du personnel
 * (contexte plateforme). Un seul accès en cours par agent : ouvrir un
 * nouvel accès termine le précédent. La salle est prévenue par e-mail.
 */
export async function startSupportAccess(
  tx: Tx,
  actor: { id: string; name: string },
  input: z.infer<typeof startSupportAccessSchema>,
  now = new Date(),
) {
  const membership = await tx.tenantMembership.findFirst({
    where: { tenantId: input.tenantId, userId: input.targetUserId, status: "ACTIVE", tenant: { deletedAt: null } },
    select: { role: true, user: { select: { name: true } }, tenant: { select: { name: true } } },
  });
  if (!membership) throw new BusinessError("Ce compte n'a pas d'accès actif à cette salle.", "targetUserId");
  if (!(SUPPORT_ACCESS_RULES.allowedRoles as readonly string[]).includes(membership.role)) {
    throw new BusinessError("Le support ne consulte pas l'espace d'un adhérent.", "targetUserId");
  }
  if (input.ticketId) {
    const ticket = await tx.supportTicket.findFirst({ where: { id: input.ticketId, tenantId: input.tenantId } });
    if (!ticket) throw new BusinessError("Ce ticket n'appartient pas à cette salle.");
  }

  await endActiveAccesses(tx, actor.id, now);
  const access = await tx.supportAccess.create({
    data: {
      tenantId: input.tenantId,
      platformUserId: actor.id,
      targetUserId: input.targetUserId,
      targetRole: membership.role,
      reason: input.reason,
      ticketId: input.ticketId ?? null,
      // Début et fin calculés sur la MÊME horloge (contrainte SQL : 2 h au plus).
      startedAt: now,
      expiresAt: new Date(now.getTime() + input.minutes * 60_000),
    },
  });
  await audit(tx, {
    tenantId: input.tenantId,
    actorUserId: actor.id,
    action: "support.access.start",
    entityType: "support_access",
    entityId: access.id,
    after: { target: membership.user.name, role: membership.role, minutes: input.minutes, reason: input.reason },
  });

  const recipients = await adminEmails(tx, input.tenantId);
  const mails = recipients.map((to) =>
    mail(
      to,
      "ZAHFIT — Le support ZahDigit consulte votre espace",
      [
        `${actor.name} (support ZahDigit) consulte l'espace de ${membership.tenant.name} tel que le voit ${membership.user.name} (${ROLE_LABELS[membership.role]}), en lecture seule, jusqu'au ${formatDateTime(access.expiresAt)}.`,
        `Motif : ${input.reason}`,
        "Aucune modification ne peut être faite au nom de votre salle pendant cet accès. L'historique complet reste consultable dans Administration → Support.",
      ],
      { href: `${appUrl()}/admin/support`, label: "Voir les accès du support" },
    ),
  );
  return { access, mails };
}

async function endActiveAccesses(tx: Tx, platformUserId: string, now: Date) {
  const active = await tx.supportAccess.findMany({
    where: { platformUserId, endedAt: null, expiresAt: { gt: now } },
    select: { id: true, tenantId: true },
  });
  for (const a of active) {
    await tx.supportAccess.update({ where: { id: a.id }, data: { endedAt: now } });
    await audit(tx, {
      tenantId: a.tenantId,
      actorUserId: platformUserId,
      action: "support.access.end",
      entityType: "support_access",
      entityId: a.id,
    });
  }
  return active;
}

/** Termine l'accès en cours de l'agent (contexte plateforme). Renvoie la salle concernée. */
export async function endSupportAccess(tx: Tx, platformUserId: string, now = new Date()) {
  const ended = await endActiveAccesses(tx, platformUserId, now);
  return ended[0]?.tenantId ?? null;
}

/**
 * Accès en cours désigné par le cookie, s'il appartient bien à cet agent
 * (contexte plateforme). Un cookie volé est inutile sans la session du
 * Super Admin qui l'a ouvert.
 */
export async function findActiveSupportAccess(tx: Tx, accessId: string, platformUserId: string, now = new Date()) {
  const access = await tx.supportAccess.findFirst({ where: { id: accessId, platformUserId } });
  return access && supportAccessActive(access, now) ? access : null;
}

/** Historique des accès du support à une salle (contexte de la salle ou plateforme). */
export async function listSupportAccesses(tx: Tx, tenantId: string, take = 50) {
  const accesses = await tx.supportAccess.findMany({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    take,
  });
  const name = await userNames(tx, accesses.flatMap((a) => [a.platformUserId, a.targetUserId]));
  return accesses.map((a) => ({ ...a, platformUserName: name(a.platformUserId), targetUserName: name(a.targetUserId) }));
}
