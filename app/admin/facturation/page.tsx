import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InvoiceList } from "@/components/billing/invoice-list";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { BILLING_RULES, SAAS_STATUS_LABELS } from "@/modules/billing/billing.rules";
import { tenantBilling } from "@/modules/billing/billing.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Abonnement ZAHFIT" };

export default async function TenantBillingPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "billing.settings.manage")) redirect("/admin");
  const billing = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => tenantBilling(tx, ctx.tenant.id));
  const sub = billing.subscription;

  return (
    <>
      <PageHeader
        title="Abonnement ZAHFIT"
        description={`Forfait ${ctx.plan.name} · factures ZahDigit et règlement en Mobile Money.`}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Statut" value={sub ? SAAS_STATUS_LABELS[sub.status] : "—"} />
        <StatCard
          label={sub?.status === "TRIALING" ? "Fin de l'essai" : "Période en cours"}
          value={
            sub?.status === "TRIALING" && sub.trialEndsOn
              ? formatDate(sub.trialEndsOn)
              : sub?.currentPeriodStart && sub.currentPeriodEnd
                ? `${formatDate(sub.currentPeriodStart)} → ${formatDate(sub.currentPeriodEnd)}`
                : "—"
          }
        />
        <StatCard
          label="Reste à régler"
          value={formatXof(billing.openTotal)}
          hint={`${billing.open.length} facture(s) ouverte(s)`}
        />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Factures payables sous {BILLING_RULES.paymentTermsDays} jours. Retard de {BILLING_RULES.readOnlyAfterDays} jours :
        espace en lecture seule ; {BILLING_RULES.suspendAfterDays} jours : accès suspendu (données conservées). Le règlement
        rétablit l&apos;accès aussitôt.
      </p>
      <InvoiceList invoices={billing.invoices} canPay today={todayCalendar()} />
    </>
  );
}
