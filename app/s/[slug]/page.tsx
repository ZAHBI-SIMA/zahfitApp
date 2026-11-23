import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/shell/logo";
import { formatXof } from "@/lib/format";
import { formatDuration } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { loadPublicTenant } from "@/modules/payments/online.service";
import { DAYS, DAY_LABELS, readOpeningHours } from "@/modules/tenants/tenants.schema";

export const metadata: Metadata = { title: "Salle de sport" };

/** Vitrine publique d'une salle : présentation, horaires, formules, inscription en ligne. */
export default function PublicTenantPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <PublicTenant params={params} />
    </Suspense>
  );
}

async function PublicTenant({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const data = await loadPublicTenant(slug);
  if (!data) notFound();
  const { tenant, plans } = data;
  const hours = readOpeningHours(tenant.openingHours);

  return (
    <main className="flex flex-1 flex-col">
      <header className="bg-primary px-6 py-10 text-primary-foreground dark:bg-sidebar sm:px-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="mt-1 opacity-80">{[tenant.address, tenant.commune, tenant.city].filter(Boolean).join(", ")}</p>
          {tenant.description && <p className="mt-4 max-w-2xl opacity-90">{tenant.description}</p>}
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 py-10" aria-labelledby="formules">
        <h2 id="formules" className="mb-4 text-xl font-semibold">
          Nos formules
        </h2>
        {plans.length === 0 ? (
          <p className="text-muted-foreground">Les formules seront bientôt disponibles en ligne.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <article key={p.id} className="flex flex-col gap-2 rounded-xl border bg-card p-5">
                <h3 className="font-medium">{p.name}</h3>
                <p className="text-2xl font-semibold">{formatXof(p.priceXof)}</p>
                <p className="text-sm text-muted-foreground">{formatDuration(p.durationValue, p.durationUnit)}</p>
                {p.benefits.length > 0 && (
                  <ul className="list-inside list-disc text-sm">
                    {p.benefits.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {p.priceXof > 0 && (
                  <Link
                    href={`/s/${tenant.slug}/inscription?formule=${p.id}`}
                    className="mt-auto inline-flex h-9 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
                  >
                    S&apos;inscrire en ligne
                  </Link>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-6 px-6 pb-12 sm:grid-cols-2" aria-label="Informations pratiques">
        <div className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="mb-3 font-medium">Horaires</h2>
          <dl className="grid grid-cols-[100px_1fr] gap-y-1">
            {DAYS.map((d) => (
              <div key={d} className="contents">
                <dt className="text-muted-foreground">{DAY_LABELS[d]}</dt>
                <dd>{hours[d]?.replace("-", " – ") ?? "Fermé"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="mb-3 font-medium">Contact</h2>
          {tenant.phone && <p>{formatPhone(tenant.phone)}</p>}
          {tenant.email && <p>{tenant.email}</p>}
        </div>
      </section>

      <footer className="mt-auto flex items-center justify-center gap-2 border-t px-6 py-4 text-xs text-muted-foreground">
        Propulsé par <Logo className="text-sm text-primary dark:text-foreground" />
      </footer>
    </main>
  );
}
