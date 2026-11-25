import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OneOffForm } from "@/components/classes/class-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { classOptions, tenantToday } from "@/modules/classes/classes.service";

export const metadata: Metadata = { title: "Séance ponctuelle" };

export default async function NewSessionPage({ searchParams }: PageProps<"/admin/planning/seance/nouvelle">) {
  const ctx = await requireSpace("admin", "CLASSES");
  if (!can(ctx.role, "classes.manage")) redirect("/admin/planning");
  const wanted = (await searchParams).date;
  const { options, today } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    options: await classOptions(tx),
    today: (await tenantToday(tx, ctx.tenant.id)).today,
  }));
  const date = typeof wanted === "string" && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : today;

  return (
    <>
      <PageHeader title="Séance ponctuelle" description="Stage, cours découverte, séance de rattrapage…">
        <Link href="/admin/planning" className="text-sm text-brand hover:underline">
          ← Planning
        </Link>
      </PageHeader>
      {options.types.length === 0 || options.coaches.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Il faut au moins un type de cours (Cours réguliers, types et salles) et un coach actif (Équipe).
        </p>
      ) : (
        <div className="max-w-5xl rounded-xl border bg-card p-5">
          <OneOffForm options={options} date={date} />
        </div>
      )}
    </>
  );
}
