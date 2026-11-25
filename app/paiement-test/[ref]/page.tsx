import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { withDbContext } from "@/lib/db";
import { formatXof } from "@/lib/format";
import { simulatePaymentAction } from "@/modules/payments/online.actions";
import { isSandboxEnabled } from "@/modules/payments/providers";

export const metadata: Metadata = { title: "Simulateur de paiement" };

/** Page du prestataire SIMULÉ (développement uniquement : 404 en production). */
export default function SandboxCheckoutPage({ params }: PageProps<"/paiement-test/[ref]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm">Chargement…</p>}>
      <SandboxCheckout params={params} />
    </Suspense>
  );
}

async function SandboxCheckout({ params }: { params: Promise<{ ref: string }> }) {
  await connection();
  if (!isSandboxEnabled()) notFound();
  const providerRef = decodeURIComponent((await params).ref);
  const payment = await withDbContext({ platform: true }, async (tx) => {
    const where = { provider: "sandbox", providerRef, status: "PENDING" as const };
    const select = { amountXof: true, tenant: { select: { name: true } } };
    // Paiement d'un adhérent, ou facture ZahDigit réglée par une salle.
    return (await tx.payment.findFirst({ where, select })) ?? (await tx.saasPayment.findFirst({ where, select }));
  });
  if (!payment) notFound();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <p className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">Simulateur — aucun argent réel</p>
      <h1 className="text-xl font-semibold">{payment.tenant.name}</h1>
      <p className="text-3xl font-semibold">{formatXof(payment.amountXof)}</p>
      <p className="font-mono text-xs text-muted-foreground">{providerRef}</p>
      <form action={simulatePaymentAction} className="flex w-full flex-col gap-3">
        <input type="hidden" name="providerRef" value={providerRef} />
        <button name="outcome" value="SUCCEEDED" className="h-10 rounded-lg bg-emerald-600 font-medium text-white hover:bg-emerald-700">
          Simuler un paiement réussi
        </button>
        <button name="outcome" value="FAILED" className="h-10 rounded-lg border font-medium hover:bg-muted">
          Simuler un échec
        </button>
      </form>
    </main>
  );
}
