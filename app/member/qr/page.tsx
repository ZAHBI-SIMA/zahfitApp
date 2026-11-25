import type { Metadata } from "next";
import { MemberQr } from "@/components/access/access-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { requireSpace } from "@/lib/session";
import { memberDayKeys } from "@/modules/access/keys";
import { effectiveStatus, todayCalendar } from "@/modules/subscriptions/dates";

export const metadata: Metadata = { title: "Mon QR Code" };

/**
 * QR Code d'entrée. Le serveur ne transmet QUE la clé du jour de CET
 * adhérent (aujourd'hui et demain) : le téléphone fabrique ensuite ses QR
 * tout seul, même si le réseau tombe à l'entrée de la salle.
 */
export default async function MemberQrPage() {
  const ctx = await requireSpace("member", "ACCESS_CONTROL");
  const today = todayCalendar();
  const member = await withTenant(ctx.tenant.id, ctx.user.id, (tx) =>
    tx.member.findFirst({
      where: { userId: ctx.user.id },
      select: {
        id: true,
        code: true,
        status: true,
        subscriptions: {
          where: { status: { in: ["ACTIVE", "FROZEN", "PENDING_PAYMENT"] } },
          orderBy: { endDate: "desc" },
          select: { planName: true, status: true, startDate: true, endDate: true },
        },
      },
    }),
  );

  if (!member) {
    return (
      <>
        <PageHeader title="Mon QR Code" />
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Votre compte n&apos;est pas encore relié à une fiche adhérent. Adressez-vous à l&apos;accueil.
        </p>
      </>
    );
  }

  const now = new Date();
  const keys = await memberDayKeys(ctx.tenant.id, member.id, now);
  const current = member.subscriptions.find((s) => effectiveStatus(s, today) === "ACTIVE");

  return (
    <>
      <PageHeader title="Mon QR Code" description={`${ctx.tenant.name} · ${member.code}`} />
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
        {current ? (
          <p className="text-center text-sm">
            <strong>{current.planName}</strong> — valable jusqu&apos;au {formatDate(current.endDate)}
          </p>
        ) : (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-center text-sm text-amber-900">
            Aucun abonnement en cours : l&apos;accès vous sera refusé. Renouvelez à l&apos;accueil.
          </p>
        )}
        <MemberQr memberId={member.id} keys={keys} serverNow={now.getTime()} />
        <p className="text-center text-xs text-muted-foreground">
          Présentez ce code au lecteur de l&apos;accueil. Augmentez la luminosité de l&apos;écran si le scan échoue.
        </p>
      </div>
    </>
  );
}
