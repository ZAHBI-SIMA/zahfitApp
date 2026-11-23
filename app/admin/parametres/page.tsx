import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TenantSettingsForm } from "@/components/tenants/tenant-forms";
import { BillingSettingsForm } from "@/components/payments/payment-forms";
import { AccessSettingsForm } from "@/components/access/access-forms";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { readOpeningHours, readSocials } from "@/modules/tenants/tenants.schema";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "tenant.settings.manage")) redirect("/admin");
  const tenant = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id } }),
  );

  return (
    <>
      <PageHeader
        title="Paramètres de la salle"
        description="Logo et photos arriveront avec le stockage de fichiers (Cloudflare R2)."
      />
      <div className="max-w-4xl rounded-xl border bg-card p-5">
        <TenantSettingsForm
          tenant={tenant}
          description={tenant.description}
          hours={readOpeningHours(tenant.openingHours)}
          socials={readSocials(tenant.socials)}
        />
      </div>

      <section className="mt-6 max-w-4xl rounded-xl border bg-card p-5" aria-labelledby="controle-acces">
        <h2 id="controle-acces" className="mb-1 text-sm font-medium">
          Contrôle d&apos;accès
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {tenant.openingHours
            ? "Les horaires d'ouverture enregistrés ci-dessus sont appliqués à l'entrée."
            : "Tant que les horaires d'ouverture ne sont pas enregistrés, l'entrée n'est pas limitée par l'heure."}
        </p>
        <AccessSettingsForm antiPassbackMinutes={tenant.antiPassbackMinutes} />
      </section>

      {can(ctx.role, "billing.settings.manage") && (
        <section className="mt-6 max-w-4xl rounded-xl border bg-card p-5" aria-labelledby="encaissements">
          <h2 id="encaissements" className="mb-1 text-sm font-medium">
            Encaissements et reçus
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Réservé à l&apos;administrateur. Prochain reçu : REC-{String(tenant.receiptSeq + 1).padStart(6, "0")}.
          </p>
          <BillingSettingsForm
            settings={{
              allowPartialPayment: tenant.allowPartialPayment,
              minDepositPercent: tenant.minDepositPercent,
              receiptFooter: tenant.receiptFooter,
            }}
          />
        </section>
      )}
    </>
  );
}
