import { RefundForm } from "@/components/payments/payment-forms";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import type { TenantContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listPlans } from "@/modules/plans/plans.service";
import {
  effectiveStatus,
  freezeAllowance,
  remainingDays,
  todayCalendar,
  type EffectiveStatus,
} from "@/modules/subscriptions/dates";
import { getMemberSubscriptions, type MemberSubscription } from "@/modules/subscriptions/subscriptions.service";
import { AssignSubscriptionForm, SubscriptionActions } from "@/components/subscriptions/subscription-forms";

const LIVE_STATUSES: EffectiveStatus[] = ["PENDING_PAYMENT", "ACTIVE", "UPCOMING", "FROZEN"];

export function statusVariant(status: EffectiveStatus) {
  switch (status) {
    case "ACTIVE":
      return "secondary" as const;
    case "PENDING_PAYMENT":
    case "EXPIRED":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

/** Net encaissé, solde, et montant encore remboursable par paiement. */
export function paymentSummary(s: Pick<MemberSubscription, "priceXof" | "payments">) {
  const confirmed = s.payments.filter((p) => p.status === "SUCCEEDED");
  const paid = confirmed.reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amountXof : p.amountXof), 0);
  const refundedOf = new Map<string, number>();
  for (const p of confirmed) {
    if (p.kind === "REFUND" && p.refundOfId) refundedOf.set(p.refundOfId, (refundedOf.get(p.refundOfId) ?? 0) + p.amountXof);
  }
  return {
    paid,
    balance: Math.max(0, s.priceXof - paid),
    payments: confirmed.map((p) => ({
      ...p,
      refundable: p.kind === "PAYMENT" ? p.amountXof - (refundedOf.get(p.id) ?? 0) : 0,
    })),
  };
}

/** Bloc « Abonnement » de la fiche adhérent. */
export async function SubscriptionPanel({
  ctx,
  memberId,
  archived,
}: {
  ctx: TenantContext;
  memberId: string;
  archived: boolean;
}) {
  const today = todayCalendar();
  const permissions = {
    canWrite: can(ctx.role, "subscriptions.write") && !archived,
    canCollect: can(ctx.role, "payments.collect"),
    canExtend: can(ctx.role, "plans.manage"),
    canCancelPaid: can(ctx.role, "plans.manage"),
  };
  const canSeePayments = can(ctx.role, "payments.read");
  const canRefund = can(ctx.role, "payments.refund");

  const { subscriptions, plans, settings } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    subscriptions: await getMemberSubscriptions(tx, memberId),
    plans: permissions.canWrite ? await listPlans(tx, { activeOnly: true }) : [],
    settings: await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: { allowPartialPayment: true },
    }),
  }));

  const enriched = subscriptions.map((s) => ({ ...s, effective: effectiveStatus(s, today), money: paymentSummary(s) }));
  const live = enriched.filter((s) => LIVE_STATUSES.includes(s.effective)).reverse(); // chronologique

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="abonnement">
      <h2 id="abonnement" className="mb-4 text-sm font-medium">
        Abonnement
      </h2>

      {live.length === 0 && (
        <p className="mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun abonnement en cours.</p>
      )}

      <div className="mb-4 flex flex-col gap-3">
        {live.map((s) => (
          <article key={s.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{s.planName}</p>
                <p className="text-sm text-muted-foreground">
                  du {formatDate(s.startDate)} au {formatDate(s.endDate)}
                </p>
                {(s.effective === "ACTIVE" || s.effective === "UPCOMING") && (
                  <p className="mt-1 text-sm">
                    <strong>{remainingDays(s, today)}</strong> jour(s) restant(s)
                  </p>
                )}
                {s.effective === "FROZEN" && s.frozenSince && (
                  <p className="mt-1 text-sm">Suspendu depuis le {formatDate(s.frozenSince)}</p>
                )}
                <p className={cn("mt-1 text-sm", s.money.balance > 0 && "font-medium text-destructive")}>
                  Payé {formatXof(s.money.paid)} sur {formatXof(s.priceXof)}
                  {s.money.balance > 0 && ` · reste ${formatXof(s.money.balance)}`}
                </p>
                {s.plan.maxFreezeDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Suspension : {freezeAllowance(s.plan.maxFreezeDays, s.frozenDays)} / {s.plan.maxFreezeDays} jour(s) disponibles
                  </p>
                )}
              </div>
              <Badge variant={statusVariant(s.effective)}>{SUBSCRIPTION_STATUS_LABELS[s.effective]}</Badge>
            </div>
            <div className="mt-3">
              <SubscriptionActions
                subscriptionId={s.id}
                status={s.effective}
                priceXof={s.priceXof}
                balanceXof={s.money.balance}
                allowPartial={settings.allowPartialPayment}
                freezeAvailable={freezeAllowance(s.plan.maxFreezeDays, s.frozenDays) > 0}
                permissions={permissions}
              />
            </div>
          </article>
        ))}
      </div>

      {permissions.canWrite && (
        <details className="rounded-lg border p-4" open={live.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {live.length === 0 ? "Attribuer une formule" : "Renouveler / attribuer une nouvelle formule"}
          </summary>
          <div className="mt-4">
            <AssignSubscriptionForm
              memberId={memberId}
              canCollect={permissions.canCollect}
              plans={plans.map((p) => ({
                id: p.id,
                name: p.name,
                priceXof: p.priceXof,
                durationValue: p.durationValue,
                durationUnit: p.durationUnit,
              }))}
            />
          </div>
        </details>
      )}

      {enriched.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Historique</h3>
          {enriched.map((s) => (
            <div key={s.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">
                  {s.planName} · {formatDate(s.startDate)} – {formatDate(s.endDate)}
                </span>
                <span className="text-muted-foreground">
                  {SUBSCRIPTION_STATUS_LABELS[s.effective]} · {formatXof(s.priceXof)}
                </span>
              </div>
              {s.cancelReason && <p className="text-xs text-muted-foreground">Annulé : {s.cancelReason}</p>}

              {canSeePayments && s.money.payments.length > 0 && (
                <ul className="mt-2 flex flex-col gap-2 border-t pt-2">
                  {s.money.payments.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {p.receipt ? (
                          <a
                            href={`/api/recus/${p.receipt.id}`}
                            target="_blank"
                            rel="noopener"
                            className="font-mono text-xs text-brand underline-offset-4 hover:underline"
                          >
                            {p.receipt.number}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">sans reçu</span>
                        )}
                        <span className={cn(p.kind === "REFUND" && "text-destructive")}>
                          {p.kind === "REFUND" ? "−" : ""}
                          {formatXof(p.amountXof)}
                        </span>
                        <span className="text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[p.method]} · {formatDate(p.paidAt)}
                          {p.providerRef && ` · réf. ${p.providerRef}`}
                          {p.reason && ` · ${p.reason}`}
                        </span>
                      </div>
                      {canRefund && p.refundable > 0 && (
                        <details className="rounded-md bg-muted/50 p-2">
                          <summary className="cursor-pointer text-xs font-medium text-destructive">Rembourser</summary>
                          <div className="mt-2">
                            <RefundForm paymentId={p.id} refundableXof={p.refundable} />
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
