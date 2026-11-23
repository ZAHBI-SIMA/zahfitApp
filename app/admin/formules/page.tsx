import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withTenant } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { WEEKDAY_LABELS, formatDuration } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { listPlans } from "@/modules/plans/plans.service";

export const metadata: Metadata = { title: "Formules" };

export default async function PlansPage({ searchParams }: PageProps<"/admin/formules">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "plans.manage")) redirect("/admin");
  const created = (await searchParams).cree === "1";
  const plans = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => listPlans(tx));

  return (
    <>
      <PageHeader title="Formules d'abonnement" description="Prix, durées, avantages et restrictions proposés à vos adhérents.">
        <Button nativeButton={false} render={<Link href="/admin/formules/nouveau" />}>
          Nouvelle formule
        </Button>
      </PageHeader>

      {created && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Formule créée. Elle est disponible immédiatement sur les fiches adhérents.
        </p>
      )}

      {plans.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucune formule. Commencez par les classiques : journalier, mensuel, trimestriel, annuel, étudiant.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <Link
              key={p.id}
              href={`/admin/formules/${p.id}`}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-brand/60"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium">{p.name}</h2>
                {!p.isActive && <Badge variant="outline">Retirée</Badge>}
              </div>
              <p className="text-2xl font-semibold">{formatXof(p.priceXof)}</p>
              <p className="text-sm text-muted-foreground">{formatDuration(p.durationValue, p.durationUnit)}</p>
              {p.benefits.length > 0 && (
                <ul className="list-inside list-disc text-sm">
                  {p.benefits.slice(0, 3).map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <p className="mt-auto text-xs text-muted-foreground">
                {[
                  p.allowedDays.length > 0 && p.allowedDays.map((d) => WEEKDAY_LABELS[d]).join(", "),
                  p.accessFrom && `${p.accessFrom}–${p.accessUntil}`,
                  p.maxEntries && `${p.maxEntries} entrées`,
                  p.maxFreezeDays > 0 && `suspension ${p.maxFreezeDays} j`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Sans restriction"}
                {" · "}
                {p._count.subscriptions} vente(s)
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
