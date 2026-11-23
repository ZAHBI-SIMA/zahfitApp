import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RenewalForm } from "@/components/messaging/messaging-forms";
import { formatDate, formatXof } from "@/lib/format";
import { findRenewalLink } from "@/modules/messaging/renewal-links";
import { inTenant, resolvePublicTenant } from "@/modules/payments/online.service";
import { computeEndDate, renewalStartDate, todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Renouveler mon abonnement", robots: { index: false } };

/**
 * Lien « renouveler en un clic » reçu dans un rappel. Le jeton suffit à
 * identifier l'adhérent : la page n'affiche donc que son prénom et la formule,
 * jamais de coordonnées.
 */
export default function RenewalPage({ params }: PageProps<"/s/[slug]/renouveler/[token]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <Renewal params={params} />
    </Suspense>
  );
}

async function Renewal({ params }: { params: Promise<{ slug: string; token: string }> }) {
  await connection();
  const { slug, token } = await params;
  const tenantId = await resolvePublicTenant(slug);
  if (!tenantId) notFound();
  const { link, state } = await inTenant(tenantId, (tx) => findRenewalLink(tx, token));
  const box = "mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center";

  if (state === "used") {
    return (
      <main className={box}>
        <h1 className="text-xl font-semibold">Renouvellement déjà payé</h1>
        <p className="text-sm text-muted-foreground">Merci ! Votre nouvel abonnement est enregistré.</p>
      </main>
    );
  }
  if (state !== "valid" || !link) {
    return (
      <main className={box}>
        <h1 className="text-xl font-semibold">{state === "expired" ? "Ce lien a expiré" : "Lien invalide"}</h1>
        <p className="text-sm text-muted-foreground">
          Renouvelez à l&apos;accueil de la salle, ou attendez le prochain rappel : il contiendra un nouveau lien.
        </p>
      </main>
    );
  }

  const plan = link.subscription.plan;
  const today = todayCalendar();
  const start = renewalStartDate(link.subscription.endDate, today);
  const end = computeEndDate(start, plan.durationValue, plan.durationUnit);
  return (
    <main className={box}>
      <h1 className="text-2xl font-semibold">Bonjour {link.member.firstName}</h1>
      {plan.isActive ? (
        <>
          <div className="w-full rounded-xl border bg-card p-5 text-left">
            <p className="text-sm text-muted-foreground">Renouvellement de votre formule</p>
            <p className="text-lg font-medium">{plan.name}</p>
            <p className="mt-2 text-2xl font-semibold">{formatXof(plan.priceXof)}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Du {formatDate(start)} au {formatDate(end)}
              {link.subscription.endDate >= today && " — à la suite de votre abonnement actuel, sans perdre un jour"}.
            </p>
          </div>
          <RenewalForm slug={slug} token={token} amountLabel={formatXof(plan.priceXof)} />
          <p className="text-xs text-muted-foreground">
            Ce lien est personnel et valable jusqu&apos;au {formatDate(link.expiresAt)}.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          La formule « {plan.name} » n&apos;est plus proposée : l&apos;accueil vous présentera les formules actuelles.
        </p>
      )}
    </main>
  );
}
