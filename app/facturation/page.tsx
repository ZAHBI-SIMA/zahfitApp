import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { InvoiceList } from "@/components/billing/invoice-list";
import { AutoRefresh } from "@/components/public/public-forms";
import { Logo } from "@/components/shell/logo";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { getTenantContext } from "@/lib/session";
import { loadSaasPayment, tenantBilling } from "@/modules/billing/billing.service";
import { todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Régler l'abonnement ZAHFIT" };

/**
 * Règlement des factures ZahDigit, HORS des espaces : accessible même quand la
 * salle est suspendue pour impayé (c'est le seul moyen d'en sortir). Sert aussi
 * de page de retour du prestataire de paiement.
 */
export default function BillingPaymentPage({ searchParams }: PageProps<"/facturation">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <BillingPayment searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingPayment({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const ctx = await getTenantContext();
  if (!ctx) redirect("/connexion");
  const paymentId = (await searchParams).paiement;
  const allowed = can(ctx.role, "billing.settings.manage");
  const data = allowed
    ? await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
        billing: await tenantBilling(tx, ctx.tenant.id),
        payment:
          typeof paymentId === "string" && /^[0-9a-f-]{36}$/.test(paymentId) ? await loadSaasPayment(tx, paymentId) : null,
      }))
    : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <Logo />
      <h1 className="text-xl font-semibold">Abonnement ZAHFIT — {ctx.tenant.name}</h1>
      {!data ? (
        <p className="text-sm text-muted-foreground">
          Seul l&apos;administrateur de la salle peut régler les factures ZahDigit.
        </p>
      ) : (
        <>
          {data.payment && (
            <div role="status" className="rounded-xl border p-4 text-sm">
              {data.payment.status === "PENDING" && (
                <>
                  <AutoRefresh />
                  Paiement de {formatXof(data.payment.amountXof)} en cours de confirmation…
                </>
              )}
              {data.payment.status === "SUCCEEDED" && (
                <p className="font-medium">
                  Merci : facture {data.payment.invoice.number} réglée.
                  {ctx.tenant.status === "ACTIVE" && " Votre espace est pleinement accessible."}
                </p>
              )}
              {(data.payment.status === "FAILED" || data.payment.status === "EXPIRED") && (
                <p>Le paiement n&apos;a pas abouti. Vous pouvez réessayer ci-dessous.</p>
              )}
            </div>
          )}
          <p className="text-sm">
            Reste à régler : <strong>{formatXof(data.billing.openTotal)}</strong>
          </p>
          <InvoiceList invoices={data.billing.open} canPay today={todayCalendar()} />
        </>
      )}
      {ctx.tenant.status === "ACTIVE" && (
        <Link href="/admin" className="text-sm text-brand hover:underline">
          Retour à l&apos;administration
        </Link>
      )}
    </main>
  );
}
