import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagingSettingsForm } from "@/components/messaging/messaging-forms";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDateTime, formatXof } from "@/lib/format";
import type { MessageStatus } from "@/lib/generated/prisma/enums";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listMessages, messagingUsage } from "@/modules/messaging/messaging.service";
import { CHANNEL_TEMPLATES } from "@/modules/messaging/templates";

export const metadata: Metadata = { title: "Messages WhatsApp et SMS" };

const STATUS: Record<MessageStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUEUED: { label: "En file", variant: "outline" },
  SENT: { label: "Envoyé", variant: "secondary" },
  DELIVERED: { label: "Remis", variant: "default" },
  READ: { label: "Lu", variant: "default" },
  FAILED: { label: "Échec", variant: "destructive" },
};

const TEMPLATE_LABELS: Record<string, string> = {
  [CHANNEL_TEMPLATES.SUBSCRIPTION_EXPIRING?.name ?? ""]: "Rappel d'échéance",
  [CHANNEL_TEMPLATES.SUBSCRIPTION_EXPIRED?.name ?? ""]: "Abonnement expiré",
  [CHANNEL_TEMPLATES.SESSION_CANCELLED?.name ?? ""]: "Séance annulée",
  [CHANNEL_TEMPLATES.WAITLIST_PROMOTED?.name ?? ""]: "Place libérée",
};

export default async function MessagesPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "tenant.settings.manage")) redirect("/admin");
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // Abidjan = UTC
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const { tenant, usage, messages } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    tenant: await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: { whatsappEnabled: true, smsEnabled: true },
    }),
    usage: await messagingUsage(tx, from, to),
    messages: await listMessages(tx, 100),
  }));
  const rate = (u: { total: number; delivered: number }) =>
    u.total ? `${Math.round((u.delivered / u.total) * 100)} % remis` : "Aucun envoi";

  return (
    <>
      <PageHeader
        title="Messages WhatsApp et SMS"
        description="Rappels envoyés aux adhérents qui l'ont accepté. Chaque message est facturé à la salle."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="WhatsApp ce mois-ci" value={usage.WHATSAPP.total} hint={rate(usage.WHATSAPP)} />
        <StatCard label="SMS ce mois-ci" value={usage.SMS.total} hint={rate(usage.SMS)} />
        <StatCard
          label="Coût du mois"
          value={formatXof(usage.WHATSAPP.costXof + usage.SMS.costXof)}
          hint={`WhatsApp ${formatXof(usage.WHATSAPP.costXof)} · SMS ${formatXof(usage.SMS.costXof)}`}
        />
      </div>

      <section className="mb-6 max-w-4xl rounded-xl border bg-card p-5" aria-labelledby="canaux">
        <h2 id="canaux" className="mb-1 text-sm font-medium">
          Canaux
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Seuls les adhérents qui ont coché WhatsApp ou SMS sur leur fiche reçoivent des messages ; ils peuvent se
          désinscrire en répondant STOP. Les notifications dans l&apos;espace adhérent et les e-mails restent gratuits.
        </p>
        {can(ctx.role, "billing.settings.manage") ? (
          <MessagingSettingsForm whatsappEnabled={tenant.whatsappEnabled} smsEnabled={tenant.smsEnabled} />
        ) : (
          <p className="text-sm">
            WhatsApp : <strong>{tenant.whatsappEnabled ? "activé" : "désactivé"}</strong> · SMS :{" "}
            <strong>{tenant.smsEnabled ? "activé" : "désactivé"}</strong>
            <span className="block text-xs text-muted-foreground">Modifiable par l&apos;administrateur (coût facturé).</span>
          </p>
        )}
      </section>

      <h2 className="mb-2 text-sm font-medium">100 derniers messages</h2>
      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucun message envoyé pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Adhérent</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Coût</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2">
                    {m.member ? (
                      <Link href={`/admin/adherents/${m.member.id}`} className="hover:underline">
                        {m.member.lastName} {m.member.firstName}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <span className="block font-mono text-xs text-muted-foreground">{m.toMasked}</span>
                  </td>
                  <td className="px-4 py-2">{TEMPLATE_LABELS[m.template] ?? m.template}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {m.channel === "WHATSAPP" ? "WhatsApp" : "SMS"}
                    {m.fallbackOfId && <span className="block text-xs text-muted-foreground">secours</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS[m.status].variant}>{STATUS[m.status].label}</Badge>
                    {m.error && (
                      <span className="block max-w-56 truncate text-xs text-destructive" title={m.error}>
                        {m.error}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatXof(m.costXof)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
