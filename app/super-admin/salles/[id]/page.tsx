import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { ExtendTrialForm } from "@/components/billing/billing-forms";
import { InvoiceList } from "@/components/billing/invoice-list";
import { TenantPlanForm } from "@/components/saas/saas-forms";
import { UsageMeter } from "@/components/saas/usage-meter";
import { EditTenantForm, SuspendTenantForm } from "@/components/tenants/tenant-forms";
import { StartSupportAccessForm } from "@/components/support/support-forms";
import { SupportAccessList } from "@/components/support/ticket-views";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ticketRef } from "@/modules/support/support.rules";
import { listSupportAccesses } from "@/modules/support/support.service";
import { withPlatform } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS, TENANT_STATUS_LABELS } from "@/lib/labels";
import { requireSuperAdmin } from "@/lib/session";
import { SAAS_STATUS_LABELS } from "@/modules/billing/billing.rules";
import { tenantBilling } from "@/modules/billing/billing.service";
import { FEATURE_LABELS } from "@/modules/saas/features";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { tenantUsage } from "@/modules/saas/saas.service";

export const metadata: Metadata = { title: "Salle cliente" };

export default async function TenantDetailPage({ params, searchParams }: PageProps<"/super-admin/salles/[id]">) {
  const user = await requireSuperAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const created = (await searchParams).cree === "1";

  const tenant = await withPlatform(user.id, (tx) =>
    tx.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
        memberships: {
          where: { role: { not: "MEMBER" } },
          include: { user: { select: { name: true, email: true, twoFactorEnabled: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  );
  if (!tenant) notFound();
  const { usage, plans, billing, accesses, openTickets } = await withPlatform(user.id, async (tx) => ({
    usage: await tenantUsage(tx, tenant.id),
    billing: await tenantBilling(tx, tenant.id),
    accesses: await listSupportAccesses(tx, tenant.id, 10),
    openTickets: await tx.supportTicket.findMany({
      where: { tenantId: tenant.id, status: { not: "CLOSED" } },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, number: true, subject: true },
    }),
    plans: await tx.saasPlan.findMany({
      orderBy: [{ sortOrder: "asc" }, { monthlyPriceXof: "asc" }],
      select: { id: true, name: true, monthlyPriceXof: true, isActive: true },
    }),
  }));
  const suspended = tenant.status === "SUSPENDED";

  return (
    <>
      <PageHeader title={tenant.name} description={`/${tenant.slug} · créée le ${formatDate(tenant.createdAt)}`}>
        <Badge variant={suspended ? "destructive" : "secondary"}>{TENANT_STATUS_LABELS[tenant.status]}</Badge>
      </PageHeader>

      {created && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Salle créée. L&apos;administrateur a reçu un lien pour choisir son mot de passe (valable 24 h).
        </p>
      )}
      {suspended && tenant.suspendedReason && (
        <p role="status" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Suspendue — motif : {tenant.suspendedReason}
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Adhérents" value={tenant._count.members} />
        <StatCard label="Personnel" value={tenant.memberships.length} />
        <StatCard label="Dernier code adhérent" value={tenant.memberSeq} />
      </div>

      <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="forfait">
        <h2 id="forfait" className="mb-1 text-sm font-medium">
          Forfait {usage.plan.name} et usage du mois
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {usage.plan.features.length === 0
            ? "Socle uniquement"
            : usage.plan.features.map((f) => FEATURE_LABELS[f]).join(" · ")}
          {usage.messagingCostXof > 0 && <> · coût WhatsApp/SMS du mois : {usage.messagingCostXof} FCFA</>}
        </p>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <UsageMeter label="Adhérents actifs" used={usage.members.used} limit={usage.members.limit} />
          <UsageMeter label="Comptes de l'équipe" used={usage.staff.used} limit={usage.staff.limit} />
          <UsageMeter
            label="WhatsApp ce mois-ci"
            used={usage.whatsapp.used}
            limit={usage.whatsapp.limit}
            unavailable={usage.plan.features.includes("MESSAGING") ? undefined : "Non inclus dans le forfait."}
            hint={`SMS : ${usage.sms}`}
          />
        </div>
        <div className="max-w-md">
          {/* key : le formulaire se reconstruit après un changement (sinon la liste garde l'ancien forfait). */}
          <TenantPlanForm key={usage.plan.id} tenantId={tenant.id} currentPlanId={usage.plan.id} plans={plans} />
        </div>
      </section>

      <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="abonnement">
        <h2 id="abonnement" className="mb-1 text-sm font-medium">
          Abonnement : {billing.subscription ? SAAS_STATUS_LABELS[billing.subscription.status] : "sans facturation"}
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {billing.subscription?.status === "TRIALING" && billing.subscription.trialEndsOn && (
            <>Essai jusqu&apos;au {formatDate(billing.subscription.trialEndsOn)} · </>
          )}
          {billing.subscription?.currentPeriodStart && billing.subscription.currentPeriodEnd && (
            <>
              Période du {formatDate(billing.subscription.currentPeriodStart)} au{" "}
              {formatDate(billing.subscription.currentPeriodEnd)} ·{" "}
            </>
          )}
          Reste à régler : {billing.openTotal} FCFA
        </p>
        {billing.subscription?.status === "TRIALING" && (
          <div className="mb-4 max-w-md">
            <ExtendTrialForm tenantId={tenant.id} />
          </div>
        )}
        <InvoiceList invoices={billing.invoices.slice(0, 6)} canPay={false} today={todayCalendar()} />
      </section>

      <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="support">
        <h2 id="support" className="mb-1 text-sm font-medium">
          Accès du support
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Afficher l&apos;espace d&apos;un membre du personnel tel qu&apos;il le voit, en consultation seule, pour diagnostiquer
          un problème. La salle est prévenue et voit chaque accès dans son historique.
          {openTickets.length > 0 && (
            <>
              {" "}
              Tickets ouverts :{" "}
              {openTickets.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <Link href={`/super-admin/support/${t.id}`} className="text-brand hover:underline">
                    {ticketRef(t.number)}
                  </Link>
                </span>
              ))}
              .
            </>
          )}
        </p>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <StartSupportAccessForm
            tenantId={tenant.id}
            staff={tenant.memberships
              .filter((m) => m.status === "ACTIVE")
              .map((m) => ({ userId: m.userId, label: `${m.user.name} — ${ROLE_LABELS[m.role]}` }))}
            tickets={openTickets.map((t) => ({ id: t.id, label: `${ticketRef(t.number)} — ${t.subject}` }))}
          />
          <SupportAccessList accesses={accesses} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-medium">Identité de la salle</h2>
          <EditTenantForm tenant={tenant} />
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">Personnel</h2>
            <ul className="space-y-2 text-sm">
              {tenant.memberships.map((m) => (
                <li key={m.id}>
                  <p className="font-medium">{m.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[m.role]} · {m.user.email}
                    {m.status === "DISABLED" && " · désactivé"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-1 text-sm font-medium">{suspended ? "Réactivation" : "Suspension"}</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {suspended
                ? "Le personnel retrouve l'accès immédiatement."
                : "Bloque l'accès du personnel ; les données sont conservées."}
            </p>
            <SuspendTenantForm tenantId={tenant.id} suspended={suspended} />
          </div>
        </aside>
      </div>
    </>
  );
}
