import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { CreateTenantForm } from "@/components/tenants/tenant-forms";
import { withPlatform } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Nouvelle salle" };

export default async function NewTenantPage() {
  const user = await requireSuperAdmin();
  const plans = await withPlatform(user.id, (tx) =>
    tx.saasPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { monthlyPriceXof: "asc" }],
      select: { id: true, name: true, monthlyPriceXof: true },
    }),
  );
  return (
    <>
      <PageHeader
        title="Nouvelle salle cliente"
        description="Crée l'espace isolé de la salle et invite son administrateur."
      />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <CreateTenantForm plans={plans} />
      </div>
    </>
  );
}
