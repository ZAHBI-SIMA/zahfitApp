import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SeriesForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { classOptions, tenantToday } from "@/modules/classes/classes.service";

export const metadata: Metadata = { title: "Nouveau cours régulier" };

export default async function NewSeriesPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "classes.manage")) redirect("/admin/planning");
  const { options, today } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    options: await classOptions(tx),
    today: (await tenantToday(tx, ctx.tenant.id)).today,
  }));

  return (
    <>
      <PageHeader
        title="Nouveau cours régulier"
        description="Un créneau chaque semaine : les séances des 8 prochaines semaines sont créées aussitôt, puis prolongées chaque jour."
      >
        <Link href="/admin/planning/cours" className="text-sm text-brand hover:underline">
          ← Cours réguliers
        </Link>
      </PageHeader>
      {options.coaches.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Aucun coach actif : invitez un membre de l&apos;équipe avec le rôle Coach (Équipe).
        </p>
      ) : (
        <div className="max-w-5xl rounded-xl border bg-card p-5">
          <SeriesForm options={options} today={today} />
        </div>
      )}
    </>
  );
}
