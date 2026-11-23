import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac/permissions";
import type { TenantContext } from "@/lib/session";
import { listPlans } from "@/modules/plans/plans.service";
import {
  effectiveStatus,
  freezeAllowance,
  remainingDays,
  todayCalendar,
  type EffectiveStatus,
} from "@/modules/subscriptions/dates";
import { getMemberSubscriptions } from "@/modules/subscriptions/subscriptions.service";
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

  const { subscriptions, plans } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    subscriptions: await getMemberSubscriptions(tx, memberId),
    plans: permissions.canWrite ? await listPlans(tx, { activeOnly: true }) : [],
  }));

  const withStatus = subscriptions.map((s) => ({ ...s, effective: effectiveStatus(s, today) }));
  const live = withStatus.filter((s) => LIVE_STATUSES.includes(s.effective)).reverse(); // chronologique

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="abonnement">
      <h2 id="abonnement" className="mb-4 text-sm font-medium">
        Abonnement
      </h2>

      {live.length === 0 && (
        <p className="mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Aucun abonnement en cours.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3">
        {live.map((s) => (
          <article key={s.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{s.planName}</p>
                <p className="text-sm text-muted-foreground">
                  du {formatDate(s.startDate)} au {formatDate(s.endDate)} · {formatXof(s.priceXof)}
                </p>
                {(s.effective === "ACTIVE" || s.effective === "UPCOMING") && (
                  <p className="mt-1 text-sm">
                    <strong>{remainingDays(s, today)}</strong> jour(s) restant(s)
                  </p>
                )}
                {s.effective === "FROZEN" && s.frozenSince && (
                  <p className="mt-1 text-sm">Suspendu depuis le {formatDate(s.frozenSince)}</p>
                )}
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

      {withStatus.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historique</h3>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Formule</th>
                <th className="py-2 pr-3 font-medium">Période</th>
                <th className="py-2 pr-3 font-medium">Statut</th>
                {canSeePayments && <th className="py-2 font-medium">Paiement</th>}
              </tr>
            </thead>
            <tbody>
              {withStatus.map((s) => {
                const payment = s.payments.find((p) => p.status === "SUCCEEDED");
                return (
                  <tr key={s.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      {s.planName}
                      <span className="block text-xs text-muted-foreground">{formatXof(s.priceXof)}</span>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDate(s.startDate)} → {formatDate(s.endDate)}
                    </td>
                    <td className="py-2 pr-3">
                      {SUBSCRIPTION_STATUS_LABELS[s.effective]}
                      {s.cancelReason && <span className="block text-xs text-muted-foreground">{s.cancelReason}</span>}
                    </td>
                    {canSeePayments && (
                      <td className="py-2">
                        {payment ? (
                          <>
                            {PAYMENT_METHOD_LABELS[payment.method]}
                            <span className="block text-xs text-muted-foreground">
                              {formatDate(payment.paidAt)}
                              {payment.providerRef && ` · réf. ${payment.providerRef}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
