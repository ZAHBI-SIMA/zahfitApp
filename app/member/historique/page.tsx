import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate, formatDateTime, formatXof } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { requireSpace } from "@/lib/session";
import { memberActivity, myMember } from "@/modules/members/member-space.service";
import { effectiveStatus, todayCalendar } from "@/modules/subscriptions/dates";
import { getMemberSubscriptions } from "@/modules/subscriptions/subscriptions.service";

export const metadata: Metadata = { title: "Mon historique" };

export default async function MemberHistoryPage() {
  const ctx = await requireSpace("member");
  const today = todayCalendar();
  const now = new Date();
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const member = await myMember(tx, ctx.user.id);
    if (!member) return null;
    return {
      subscriptions: await getMemberSubscriptions(tx, member.id),
      activity: await memberActivity(tx, member.id, now),
    };
  });

  if (!data) {
    return (
      <>
        <PageHeader title="Mon historique" />
        <p className="text-sm text-muted-foreground">Aucune fiche adhérent liée à votre compte.</p>
      </>
    );
  }
  const payments = data.subscriptions
    .flatMap((s) => s.payments.map((p) => ({ ...p, planName: s.planName })))
    .filter((p) => p.status === "SUCCEEDED")
    .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const { purchases, visits, classes } = data.activity;
  const section = "mb-6 rounded-xl border bg-card p-5";

  return (
    <>
      <PageHeader title="Mon historique" description="Abonnements, paiements, achats, passages et cours suivis." />

      <section className={section} aria-labelledby="abonnements">
        <h2 id="abonnements" className="mb-3 text-sm font-medium">
          Abonnements
        </h2>
        {data.subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun abonnement.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {[...data.subscriptions].reverse().map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {s.planName} · {formatDate(s.startDate)} → {formatDate(s.endDate)}
                </span>
                <span className="text-muted-foreground">{SUBSCRIPTION_STATUS_LABELS[effectiveStatus(s, today)]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="paiements">
        <h2 id="paiements" className="mb-3 text-sm font-medium">
          Paiements et reçus
        </h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun paiement.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.paidAt ? formatDate(p.paidAt) : "—"} · {p.kind === "REFUND" ? "Remboursement" : p.planName}
                </span>
                <span className="flex items-center gap-3">
                  <strong className={p.kind === "REFUND" ? "text-destructive" : undefined}>
                    {p.kind === "REFUND" ? "−" : ""}
                    {formatXof(p.amountXof)}
                  </strong>
                  {p.receipt && (
                    <a
                      href={`/api/recus/${p.receipt.id}`}
                      target="_blank"
                      rel="noopener"
                      className="font-mono text-xs text-brand hover:underline"
                    >
                      {p.receipt.number}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="achats">
        <h2 id="achats" className="mb-3 text-sm font-medium">
          Achats boutique
        </h2>
        {purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {purchases.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatDate(s.createdAt)} · {s.lines.map((l) => `${l.quantity} × ${l.productName}`).join(", ")}
                  {s.status === "VOIDED" && (
                    <>
                      {" "}
                      <Badge variant="outline">Annulé</Badge>
                    </>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <strong>{formatXof(s.totalXof)}</strong>
                  <a
                    href={`/api/ventes/${s.id}`}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-xs text-brand hover:underline"
                  >
                    {s.number}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className={section} aria-labelledby="passages">
          <h2 id="passages" className="mb-3 text-sm font-medium">
            Derniers passages
          </h2>
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun passage enregistré.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {visits.map((v) => (
                <li key={v.id}>{formatDateTime(v.occurredAt)}</li>
              ))}
            </ul>
          )}
        </section>

        <section className={section} aria-labelledby="cours-suivis">
          <h2 id="cours-suivis" className="mb-3 text-sm font-medium">
            Cours suivis
          </h2>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun cours passé.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {classes.map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span>
                    {b.session.classType.name} · {formatDateTime(b.session.startsAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {b.attendance === "PRESENT" ? "Présent" : b.attendance === "ABSENT" ? "Absent" : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
