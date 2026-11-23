import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "@/modules/messaging/messaging.actions";
import { parseUnsubscribeToken } from "@/modules/messaging/providers";

export const metadata: Metadata = { title: "Se désinscrire", robots: { index: false } };

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", SMS: "SMS" } as const;

/**
 * Lien « STOP » de chaque SMS. L'ouverture du lien ne désinscrit pas : il faut
 * confirmer (les aperçus automatiques des messageries ouvrent aussi les liens).
 */
export default function UnsubscribePage({ params, searchParams }: PageProps<"/desinscription/[token]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Chargement…</p>}>
      <Unsubscribe params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Unsubscribe({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const token = decodeURIComponent((await params).token);
  const query = await searchParams;
  const parsed = parseUnsubscribeToken(token);
  const box = "mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center";

  if (query.fait) {
    return (
      <main className={box}>
        <h1 className="text-xl font-semibold">C&apos;est noté</h1>
        <p className="text-sm text-muted-foreground">
          Vous ne recevrez plus de messages {parsed ? CHANNEL_LABEL[parsed.channel] : ""} de la salle. Vous pouvez changer
          d&apos;avis à tout moment à l&apos;accueil.
        </p>
      </main>
    );
  }
  if (!parsed || query.invalide) {
    return (
      <main className={box}>
        <h1 className="text-xl font-semibold">Lien invalide</h1>
        <p className="text-sm text-muted-foreground">
          Répondez STOP au message, ou demandez à l&apos;accueil de retirer votre consentement.
        </p>
      </main>
    );
  }
  return (
    <main className={box}>
      <h1 className="text-xl font-semibold">Ne plus recevoir de {CHANNEL_LABEL[parsed.channel]} ?</h1>
      <p className="text-sm text-muted-foreground">
        La salle ne vous enverra plus de rappels par {CHANNEL_LABEL[parsed.channel]}. Les autres canaux auxquels vous avez
        consenti ne changent pas.
      </p>
      <form action={unsubscribeAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg">
          Confirmer la désinscription
        </Button>
      </form>
    </main>
  );
}
