import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Réception" };

export default async function ReceptionHome() {
  const ctx = await requireSpace("reception");
  const has = (feature: (typeof ctx.features)[number]) => ctx.features.includes(feature);
  const secondary = "inline-flex h-10 items-center rounded-lg border px-5 font-medium hover:bg-muted";

  return (
    <>
      <PageHeader title="Accueil" description={`Réception — ${ctx.tenant.name}`} />
      <div className="mb-6 flex flex-wrap gap-3">
        {has("ACCESS_CONTROL") && can(ctx.role, "access.scan") && (
          <Link
            href="/reception/scan"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-5 font-medium text-brand-foreground"
          >
            Contrôle d&apos;accès
          </Link>
        )}
        {can(ctx.role, "payments.collect") && (
          <Link href="/reception/encaisser" className={secondary}>
            Encaisser
          </Link>
        )}
        {has("CLASSES") && can(ctx.role, "classes.read") && (
          <Link href="/reception/planning" className={secondary}>
            Planning
          </Link>
        )}
        {has("SHOP") && can(ctx.role, "shop.sell") && (
          <Link href="/reception/boutique" className={secondary}>
            Boutique
          </Link>
        )}
      </div>
    </>
  );
}
