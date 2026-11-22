import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { CreateTenantForm } from "@/components/tenants/tenant-forms";
import { requireSuperAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Nouvelle salle" };

export default async function NewTenantPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader
        title="Nouvelle salle cliente"
        description="Crée l'espace isolé de la salle et invite son administrateur."
      />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <CreateTenantForm />
      </div>
    </>
  );
}
