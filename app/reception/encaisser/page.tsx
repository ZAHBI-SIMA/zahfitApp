import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { CollectPaymentForm } from "@/components/subscriptions/subscription-forms";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { todayCalendar } from "@/modules/subscriptions/dates";
import { subscriptionReport } from "@/modules/subscriptions/subscriptions.service";

export const metadata: Metadata = { title: "Encaisser" };

/** Caisse de l'accueil : tout ce qui attend un paiement, encaissable sur place. */
export default async function CollectPage() {
  const ctx = await requireSpace("reception");
  if (!can(ctx.role, "payments.collect")) redirect("/reception");
  const today = todayCalendar();
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    pending: await subscriptionReport(tx, "en-attente", today),
    unpaid: await subscriptionReport(tx, "impayes", today),
    settings: await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { allowPartialPayment: true } }),
  }));

  const sections = [
    { title: "En attente de paiement", rows: data.pending, empty: "Aucun abonnement en attente." },
    { title: "Soldes impayés", rows: data.unpaid, empty: "Aucun solde impayé." },
  ];

  return (
    <>
      <PageHeader
        title="Encaisser"
        description="Pour un nouvel abonnement, ouvrez la fiche de l'adhérent (Adhérents → Attribuer une formule)."
      />
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h2 className="mb-3 text-sm font-medium">
              {section.title} ({section.rows.length})
            </h2>
            {section.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{section.empty}</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {section.rows.map((s) => (
                  <article key={s.id} className="rounded-xl border bg-card p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link href={`/reception/adherents/${s.member.id}`} className="font-medium hover:underline">
                          {s.member.lastName} {s.member.firstName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {s.member.code} · {formatPhone(s.member.phone)}
                        </p>
                        <p className="mt-1 text-sm">
                          {s.planName} · du {formatDate(s.startDate)} au {formatDate(s.endDate)}
                        </p>
                      </div>
                      <p className="text-lg font-semibold text-destructive">{formatXof(s.balanceXof)}</p>
                    </div>
                    <CollectPaymentForm
                      subscriptionId={s.id}
                      amountXof={s.balanceXof}
                      allowPartial={data.settings.allowPartialPayment}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
