import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OnlineSignupForm } from "@/components/public/public-forms";
import { formatXof } from "@/lib/format";
import { formatDuration } from "@/lib/labels";
import { loadPublicTenant } from "@/modules/payments/online.service";

export const metadata: Metadata = { title: "Inscription en ligne" };

export default function SignupPage({ params, searchParams }: PageProps<"/s/[slug]/inscription">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <Signup params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Signup({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { slug } = await params;
  const planId = (await searchParams).formule;
  const data = await loadPublicTenant(slug);
  if (!data) notFound();
  const plan = data.plans.find((p) => p.id === planId && p.priceXof > 0);
  if (!plan) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <Link href={`/s/${slug}`} className="text-sm text-muted-foreground hover:underline">
        ← {data.tenant.name}
      </Link>
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">Formule choisie</p>
        <p className="text-lg font-semibold">
          {plan.name} · {formatXof(plan.priceXof)}
        </p>
        <p className="text-sm text-muted-foreground">{formatDuration(plan.durationValue, plan.durationUnit)}</p>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <h1 className="mb-4 text-xl font-semibold">Vos informations</h1>
        <OnlineSignupForm slug={slug} planId={plan.id} amountLabel={formatXof(plan.priceXof)} />
      </div>
    </main>
  );
}
