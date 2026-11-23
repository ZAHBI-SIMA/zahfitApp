import { withDbContext, type Tx } from "@/lib/db";
import { formatDate } from "@/lib/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { NotificationType } from "@/lib/generated/prisma/enums";
import { sendMail } from "@/lib/mail";
import { localParts } from "@/lib/timezone";
import { addDaysIso } from "@/modules/classes/schedule";
import { EMAIL_BY_DEFAULT, emailText, render, type TemplateData } from "@/modules/notifications/templates";

/**
 * Moteur de notifications : ÉVÉNEMENT → MODÈLE → CANAUX.
 *
 *  - `notifyMember()` s'appelle DANS la transaction de l'événement : la
 *    notification (application) et l'e-mail en attente (boîte d'envoi) sont
 *    écrits avec le reste, ou pas du tout si la transaction échoue.
 *  - `flushEmails()` envoie APRÈS validation ; la tâche planifiée relance
 *    les échecs. Une action annulée n'envoie donc jamais d'e-mail.
 *  - `dedupeKey` (unique par salle) rend les rappels idempotents.
 *
 * Messages de service (réservation, échéance…) : envoyés sans le
 * consentement « communications commerciales », qui ne concerne que la prospection.
 */

const MAX_EMAIL_ATTEMPTS = 5;
const appUrl = () => process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3100";

export async function notifyMember(
  tx: Tx,
  tenantId: string,
  memberId: string,
  type: NotificationType,
  data: Omit<TemplateData, "tenantName" | "firstName">,
  options: { dedupeKey?: string; email?: boolean } = {},
): Promise<string | null> {
  const member = await tx.member.findUnique({
    where: { id: memberId },
    select: { userId: true, email: true, firstName: true, status: true, tenant: { select: { name: true } } },
  });
  if (!member || member.status === "ARCHIVED") return null;
  const wantsEmail = (options.email ?? EMAIL_BY_DEFAULT[type]) && !!member.email;
  if (!member.userId && !wantsEmail) return null; // personne à prévenir

  if (options.dedupeKey) {
    const existing = await tx.notification.findUnique({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey: options.dedupeKey } },
      select: { id: true },
    });
    if (existing) return null;
  }

  const full: TemplateData = { ...data, tenantName: member.tenant.name, firstName: member.firstName };
  const rendered = render(type, full);
  const created = await tx.notification.create({
    data: {
      tenantId,
      userId: member.userId,
      memberId,
      type,
      ...rendered,
      dedupeKey: options.dedupeKey ?? null,
      ...(wantsEmail
        ? {
            emailStatus: "PENDING" as const,
            emailTo: member.email,
            emailSubject: `${member.tenant.name} — ${rendered.title}`,
            emailText: emailText(full, rendered, appUrl()),
          }
        : {}),
    },
    select: { id: true },
  });
  return created.id;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Envoie les e-mails en attente (d'une salle, ou de toutes pour la tâche
 * planifiée). L'adresse est effacée une fois l'e-mail parti.
 */
export async function flushEmails(tenantId: string | null, limit = 50) {
  const ctx = tenantId ? { tenantId } : { platform: true as const };
  const pending = await withDbContext(ctx, (tx) =>
    tx.notification.findMany({
      where: { emailStatus: "PENDING", emailAttempts: { lt: MAX_EMAIL_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, tenantId: true, emailTo: true, emailSubject: true, emailText: true, emailAttempts: true },
    }),
  );
  const summary = { sent: 0, failed: 0 };
  for (const n of pending) {
    let sent = false;
    try {
      if (n.emailTo && n.emailSubject && n.emailText) {
        await sendMail({
          to: n.emailTo,
          subject: n.emailSubject,
          text: n.emailText,
          html: n.emailText
            .split("\n\n")
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
            .join(""),
        });
        sent = true;
      }
    } catch {
      // Prestataire indisponible : nouvel essai au prochain passage.
    }
    const attempts = n.emailAttempts + 1;
    await withDbContext({ tenantId: n.tenantId }, (tx) =>
      tx.notification.update({
        where: { id: n.id },
        data: sent
          ? { emailStatus: "SENT", emailSentAt: new Date(), emailTo: null, emailAttempts: attempts }
          : { emailAttempts: attempts, ...(attempts >= MAX_EMAIL_ATTEMPTS ? { emailStatus: "FAILED" as const } : {}) },
      }),
    );
    if (sent) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

/** Envoi après une action : un échec d'e-mail ne fait jamais échouer l'action. */
export async function flushEmailsQuietly(tenantId: string) {
  try {
    await flushEmails(tenantId, 20);
  } catch {
    // La tâche planifiée reprendra.
  }
}

// --- Rappels d'échéance (tâche planifiée) ----------------------------------

/** Aucun abonnement suivant (renouvellement) n'existe déjà. */
const notRenewed = (endDate: Date): Prisma.SubscriptionWhereInput => ({
  member: {
    status: { not: "ARCHIVED" },
    subscriptions: {
      none: { status: { in: ["ACTIVE", "PENDING_PAYMENT", "FROZEN"] }, startDate: { gt: endDate } },
    },
  },
});

/**
 * J-7 et J-3 avant la fin, puis J0 (lendemain de la fin) : un seul envoi par
 * abonnement et par étape, et rien si l'adhérent a déjà renouvelé.
 */
export async function runSubscriptionReminders(tx: Tx, tenantId: string, today: string) {
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
  let created = 0;
  for (const days of [7, 3]) {
    const endDate = date(addDaysIso(today, days));
    const subs = await tx.subscription.findMany({
      where: { status: "ACTIVE", endDate, ...notRenewed(endDate) },
      select: { id: true, memberId: true, planName: true, endDate: true },
    });
    for (const s of subs) {
      const id = await notifyMember(
        tx,
        tenantId,
        s.memberId,
        "SUBSCRIPTION_EXPIRING",
        { planName: s.planName, endDate: formatDate(s.endDate), days },
        { dedupeKey: `sub-expiring-${days}:${s.id}` },
      );
      if (id) created++;
    }
  }
  const yesterday = date(addDaysIso(today, -1));
  const expired = await tx.subscription.findMany({
    where: { status: "ACTIVE", endDate: yesterday, ...notRenewed(yesterday) },
    select: { id: true, memberId: true, planName: true, endDate: true },
  });
  for (const s of expired) {
    const id = await notifyMember(
      tx,
      tenantId,
      s.memberId,
      "SUBSCRIPTION_EXPIRED",
      { planName: s.planName, endDate: formatDate(s.endDate) },
      { dedupeKey: `sub-expired:${s.id}` },
    );
    if (id) created++;
  }
  return created;
}

/** Tâche planifiée : rappels de chaque salle active, puis envoi des e-mails. */
export async function runAllNotifications(now = new Date()) {
  const tenants = await withDbContext({ platform: true }, (tx) =>
    tx.tenant.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, timezone: true } }),
  );
  let reminders = 0;
  for (const t of tenants) {
    const today = localParts(now, t.timezone).date;
    reminders += await withDbContext({ tenantId: t.id }, (tx) => runSubscriptionReminders(tx, t.id, today));
  }
  const emails = await flushEmails(null, 200);
  return { tenants: tenants.length, reminders, emails };
}

// --- Notifications de l'adhérent ---------------------------------------------

export function listNotifications(tx: Tx, userId: string, take = 50) {
  return tx.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
}

export const unreadCount = (tx: Tx, userId: string) => tx.notification.count({ where: { userId, readAt: null } });

export function markAllRead(tx: Tx, userId: string) {
  return tx.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
