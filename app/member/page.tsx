import type { Metadata } from "next";
import { PageHeader, UpcomingList } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { requireSpace } from "@/lib/session";
import { effectiveStatus, remainingDays, todayCalendar } from "@/modules/subscriptions/dates";
import { getMemberSubscriptions } from "@/modules/subscriptions/subscriptions.service";
import { unreadCount } from "@/modules/notifications/notifications.service";
import Link from "next/link";
import { statusVariant } from "@/components/subscriptions/subscription-panel";

export const metadata: Metadata = { title: "Mon espace" };

export default async function MemberHome() {
  const ctx = await requireSpace("member");
  const today = todayCalendar();

  // L'adhérent ne lit QUE sa propre fiche (liée à son compte de connexion).
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const member = await tx.member.findFirst({
      where: { userId: ctx.user.id },
      select: { id: true, code: true },
    });
    return member
      ? {
          member,
          subscriptions: await getMemberSubscriptions(tx, member.id),
          unread: await unreadCount(tx, ctx.user.id),
        }
      : null;
  });

  const subs = (data?.subscriptions ?? []).map((s) => ({ ...s, effective: effectiveStatus(s, today) }));
  const current = subs.filter((s) => ["ACTIVE", "FROZEN", "UPCOMING", "PENDING_PAYMENT"].includes(s.effective)).reverse();
  const receipts = subs
    .flatMap((s) => s.payments.map((p) => ({ ...p, planName: s.planName })))
    .filter((p) => p.status === "SUCCEEDED" && p.receipt)
    .reverse();

  return (
    <>
      <PageHeader
        title={`Bonjour ${ctx.user.name.split(" ")[0]}`}
        description={`${ctx.tenant.name}${data ? ` · n° adhérent ${data.member.code}` : ""}`}
      />

      {data && data.unread > 0 && (
        <Link
          href="/member/notifications"
          className="mb-4 block rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm hover:bg-brand/15"
        >
          {data.unread} nouvelle(s) notification(s)
        </Link>
      )}

      <section className="mb-6 flex flex-col gap-3" aria-labelledby="mon-abonnement">
        <h2 id="mon-abonnement" className="text-sm font-medium">
          Mon abonnement
        </h2>
        {current.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Aucun abonnement en cours. Passez à l&apos;accueil pour renouveler.
          </div>
        ) : (
          current.map((s) => (
            <article key={s.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{s.planName}</p>
                  <p className="text-sm text-muted-foreground">
                    du {formatDate(s.startDate)} au {formatDate(s.endDate)}
                  </p>
                </div>
                <Badge variant={statusVariant(s.effective)}>{SUBSCRIPTION_STATUS_LABELS[s.effective]}</Badge>
              </div>
              {(s.effective === "ACTIVE" || s.effective === "UPCOMING") && (
                <p className="mt-3 text-3xl font-semibold">
                  {remainingDays(s, today)} <span className="text-base font-normal text-muted-foreground">jour(s) restant(s)</span>
                </p>
              )}
              {s.effective === "PENDING_PAYMENT" && (
                <p className="mt-3 text-sm">Montant à régler à l&apos;accueil : {formatXof(s.priceXof)}</p>
              )}
            </article>
          ))
        )}
      </section>

      {subs.length > 0 && (
        <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="historique">
          <h2 id="historique" className="mb-3 text-sm font-medium">
            Historique
          </h2>
          <ul className="space-y-2 text-sm">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {s.planName} · {formatDate(s.startDate)} → {formatDate(s.endDate)}
                </span>
                <span className="text-muted-foreground">{SUBSCRIPTION_STATUS_LABELS[s.effective]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipts.length > 0 && (
        <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="recus">
          <h2 id="recus" className="mb-3 text-sm font-medium">
            Mes reçus
          </h2>
          <ul className="space-y-2 text-sm">
            {receipts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <a href={`/api/recus/${p.receipt!.id}`} target="_blank" rel="noopener" className="font-mono text-brand hover:underline">
                  {p.receipt!.number}
                </a>
                <span className="text-muted-foreground">
                  {p.planName} · {formatDate(p.paidAt)} · {p.kind === "REFUND" ? "−" : ""}
                  {formatXof(p.amountXof)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <UpcomingList
        items={[
          { sprint: 11, label: "Renouveler en ligne depuis mon espace" },
        ]}
      />
    </>
  );
}
