import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { PlanForm } from "@/components/plans/plan-form";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { getPlan } from "@/modules/plans/plans.service";

export const metadata: Metadata = { title: "Formule" };

export default async function PlanPage({ params }: PageProps<"/admin/formules/[id]">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "plans.manage")) redirect("/admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const plan = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => getPlan(tx, id));
  if (!plan) notFound();

  return (
    <>
      <PageHeader
        title={plan.name}
        description="Les modifications de prix ou de durée s'appliquent aux PROCHAINES ventes uniquement."
      />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <PlanForm plan={plan} />
      </div>
    </>
  );
}
