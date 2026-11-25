import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { UsageMeter } from "@/components/saas/usage-meter";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { FEATURE_LABELS, SAAS_FEATURES } from "@/modules/saas/features";
import { tenantUsage } from "@/modules/saas/saas.service";

export const metadata: Metadata = { title: "Mon forfait" };

export default async function MyPlanPage({ searchParams }: PageProps<"/admin/forfait">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "tenant.settings.manage")) redirect("/admin");
  const wanted = (await searchParams).module;
  const missing = SAAS_FEATURES.find((f) => f === wanted);

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    usage: await tenantUsage(tx, ctx.tenant.id),
    plans: await tx.saasPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { monthlyPriceXof: "asc" }],
    }),
  }));
  const { usage } = data;

  return (
    <>
      <PageHeader
        title="Mon forfait"
        description={`Forfait ZAHFIT de ${ctx.tenant.name} : modules inclus et usage du mois.`}
      />

      {missing && (
        <div role="alert" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">
            « {FEATURE_LABELS[missing]} » n&apos;est pas inclus dans votre forfait {usage.plan.name}.
          </p>
          <p className="text-muted-foreground">
            Contactez ZahDigit pour passer à un forfait qui l&apos;inclut (comparatif ci-dessous).
          </p>
        </div>
      )}

      <section className="mb-8" aria-labelledby="usage">
        <h2 id="usage" className="mb-3 text-sm font-medium">
          Forfait {usage.plan.name} — usage
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <UsageMeter
            label="Adhérents actifs"
            used={usage.members.used}
            limit={usage.members.limit}
            hint="Les adhérents archivés ne comptent pas."
          />
          <UsageMeter label="Comptes de l'équipe" used={usage.staff.used} limit={usage.staff.limit} />
          <UsageMeter
            label="WhatsApp ce mois-ci"
            used={usage.whatsapp.used}
            limit={usage.whatsapp.limit}
            unavailable={usage.plan.features.includes("MESSAGING") ? undefined : "Non inclus dans le forfait."}
            hint={`Quota atteint : repli SMS (si accepté) ou notification dans l'application. SMS du mois : ${usage.sms}.`}
          />
        </div>
      </section>

      <section aria-labelledby="comparatif">
        <h2 id="comparatif" className="mb-3 text-sm font-medium">
          Comparer les forfaits
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {data.plans.map((p) => {
            const current = p.id === ctx.plan.id;
            const features = p.features ?? [];
            return (
              <article
                key={p.id}
                className={cn("flex flex-col gap-3 rounded-xl border bg-card p-5", current && "border-brand ring-1 ring-brand")}
              >
                <div>
                  <p className="text-lg font-semibold">
                    {p.name} {current && <span className="text-xs font-normal text-brand">· votre forfait</span>}
                  </p>
                  <p className="text-2xl font-semibold">
                    {formatXof(p.monthlyPriceXof)}
                    <span className="text-sm font-normal text-muted-foreground"> / mois</span>
                  </p>
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  <li>✓ Adhérents, abonnements, paiements, caisse, dépenses</li>
                  {SAAS_FEATURES.map((f) => (
                    <li key={f} className={cn(!features.includes(f) && "text-muted-foreground line-through")}>
                      {features.includes(f) ? "✓" : "✗"} {FEATURE_LABELS[f]}
                    </li>
                  ))}
                </ul>
                <p className="mt-auto text-xs text-muted-foreground">
                  {p.maxMembers ?? "∞"} adhérents · {p.maxStaff ?? "∞"} comptes équipe · {p.maxWhatsappPerMonth ?? "∞"}{" "}
                  WhatsApp / mois
                </p>
              </article>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Pour changer de forfait, contactez l&apos;équipe ZahDigit.</p>
      </section>
    </>
  );
}
