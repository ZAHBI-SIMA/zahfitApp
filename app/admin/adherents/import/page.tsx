import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImportMembersForm } from "@/components/members/import-form";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Importer des adhérents" };

export default async function ImportMembersPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "members.write")) redirect("/admin/adherents");

  return (
    <>
      <PageHeader
        title="Importer des adhérents"
        description="Reprenez votre fichier Excel existant : enregistrez-le au format CSV, vérifiez l'aperçu, puis importez."
      />
      <div className="mb-6 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Colonnes attendues</p>
        <p className="mt-1 text-muted-foreground">
          <code>nom</code>, <code>prenom</code>, <code>telephone</code> (obligatoires) et <code>email</code>{" "}
          (facultatif). Séparateur « ; » ou « , ». Les doublons (même téléphone) sont ignorés.
        </p>
        {/* Téléchargement d'un fichier (Route Handler) : <a download>, pas une navigation <Link>. */}
        <a
          href="/admin/adherents/import/modele"
          download
          className="mt-2 inline-block text-brand underline-offset-4 hover:underline"
        >
          Télécharger le modèle CSV
        </a>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <ImportMembersForm />
      </div>
    </>
  );
}
