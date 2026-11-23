import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import * as z from "zod";
import { AutoRefresh } from "@/components/public/public-forms";
import { formatDate, formatXof } from "@/lib/format";
import { inTenant, resolvePublicTenant } from "@/modules/payments/online.service";

export const metadata: Metadata = { title: "Suivi du paiement" };

/**
 * Page de RETOUR du prestataire. Elle n'active rien : elle affiche l'état
 * enregistré en base, que seul le webhook signé (ou le rapprochement) modifie.
 */
export default function PaymentStatusPage({ params }: PageProps<"/s/[slug]/paiement/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <PaymentStatus params={params} />
    </Suspense>
  );
}

async function PaymentStatus({ params }: { params: Promise<{ slug: string; id: string }> }) {
  await connection();
  const { slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tenantId = await resolvePublicTenant(slug);
  if (!tenantId) notFound();
  const payment = await inTenant(tenantId, (tx) =>
    tx.payment.findFirst({
      where: { id, provider: { not: "manual" } },
      select: {
        status: true,
        amountXof: true,
        receipt: { select: { number: true } },
        member: { select: { firstName: true } },
        subscription: { select: { planId: true, planName: true, startDate: true, endDate: true, previousId: true } },
      },
    }),
  );
  if (!payment) notFound();

  const box = "mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center";
  if (payment.status === "PENDING") {
    return (
      <main className={box} aria-live="polite">
        <AutoRefresh />
        <div className="size-10 animate-spin rounded-full border-4 border-muted border-t-brand" aria-hidden />
        <h1 className="text-xl font-semibold">Paiement en cours de confirmation…</h1>
        <p className="text-sm text-muted-foreground">
          Validez l&apos;opération sur votre téléphone si ce n&apos;est pas déjà fait. Cette page se met à jour toute seule.
        </p>
      </main>
    );
  }
  if (payment.status === "SUCCEEDED") {
    const renewal = Boolean(payment.subscription?.previousId);
    return (
      <main className={box}>
        <h1 className="text-2xl font-semibold">
          {renewal ? "Merci" : "Bienvenue"} {payment.member.firstName} !
        </h1>
        <p>
          Paiement de <strong>{formatXof(payment.amountXof)}</strong> confirmé
          {payment.receipt && <> — reçu {payment.receipt.number}</>}.
        </p>
        {payment.subscription && (
          <p className="text-sm text-muted-foreground">
            Abonnement {payment.subscription.planName} du {formatDate(payment.subscription.startDate)} au{" "}
            {formatDate(payment.subscription.endDate)}.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {renewal
            ? "Votre abonnement est renouvelé ; le reçu est disponible dans votre espace."
            : "Votre reçu et un lien pour créer votre mot de passe vous ont été envoyés par e-mail."}
        </p>
        <Link href="/connexion" className="text-sm text-brand hover:underline">
          Accéder à mon espace
        </Link>
      </main>
    );
  }
  return (
    <main className={box}>
      <h1 className="text-xl font-semibold">Le paiement n&apos;a pas abouti</h1>
      <p className="text-sm text-muted-foreground">Aucun montant n&apos;a été encaissé et votre abonnement n&apos;est pas activé.</p>
      {payment.subscription && (
        <Link
          href={`/s/${slug}/inscription?formule=${payment.subscription.planId}`}
          className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground"
        >
          Réessayer
        </Link>
      )}
    </main>
  );
}
