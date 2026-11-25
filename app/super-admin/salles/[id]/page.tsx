import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { PageHeader, StatCard } from "@/components/shell/page-header";
import { TenantPlanForm } from "@/components/saas/saas-forms";
import { UsageMeter } from "@/components/saas/usage-meter";
import { EditTenantForm, SuspendTenantForm } from "@/components/tenants/tenant-forms";
import { Badge } from "@/components/ui/badge";
import { withPlatform } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS, TENANT_STATUS_LABELS } from "@/lib/labels";
import { requireSuperAdmin } from "@/lib/session";
import { FEATURE_LABELS } from "@/modules/saas/features";
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
  const { usage, plans } = await withPlatform(user.id, async (tx) => ({
    usage: await tenantUsage(tx, tenant.id),
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
