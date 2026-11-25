import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { SaasPlanForm } from "@/components/saas/saas-forms";
import { Badge } from "@/components/ui/badge";
import { withPlatform } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { requireSuperAdmin } from "@/lib/session";
import { FEATURE_LABELS } from "@/modules/saas/features";
import { listSaasPlans } from "@/modules/saas/saas.service";

export const metadata: Metadata = { title: "Forfaits SaaS" };

const limit = (n: number | null) => (n === null ? "illimité" : String(n));

export default async function SaasPlansPage() {
  const user = await requireSuperAdmin();
  const plans = await withPlatform(user.id, (tx) => listSaasPlans(tx));

  return (
    <>
      <PageHeader
        title="Forfaits SaaS"
        description="Modules et limites de chaque forfait. Une modification s'applique immédiatement aux salles concernées."
      />
      <ul className="mb-8 flex flex-col gap-4">
        {plans.map((p) => {
          const features = p.features ?? [];
          return (
            <li key={p.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">
                    {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>{" "}
                    {!p.isActive && <Badge variant="outline">Retiré de la vente</Badge>}
                  </p>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {limit(p.maxMembers)} adhérents · {limit(p.maxStaff)} comptes équipe ·{" "}
                    {limit(p.maxWhatsappPerMonth)} WhatsApp / mois
                  </p>
                  <p className="mt-1 text-xs">
                    {features.length === 0 ? "Socle uniquement" : features.map((f) => FEATURE_LABELS[f]).join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">
                    {formatXof(p.monthlyPriceXof)}
                    <span className="text-sm font-normal text-muted-foreground"> / mois</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Installation {formatXof(p.setupFeeXof)}</p>
                  <p className="text-xs text-muted-foreground">{p._count.tenants} salle(s)</p>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">Modifier</summary>
                <div className="mt-3">
                  <SaasPlanForm plan={{ ...p, features }} />
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <section className="rounded-xl border bg-card p-5" aria-labelledby="nouveau-forfait">
        <h2 id="nouveau-forfait" className="mb-4 text-sm font-medium">
          Nouveau forfait
        </h2>
        <SaasPlanForm />
      </section>
    </>
  );
}
