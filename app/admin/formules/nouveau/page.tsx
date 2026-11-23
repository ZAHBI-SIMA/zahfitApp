import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanForm } from "@/components/plans/plan-form";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";

export const metadata: Metadata = { title: "Nouvelle formule" };

export default async function NewPlanPage() {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "plans.manage")) redirect("/admin");
  return (
    <>
      <PageHeader title="Nouvelle formule" />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <PlanForm />
      </div>
    </>
  );
}
