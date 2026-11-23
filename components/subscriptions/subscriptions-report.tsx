import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { withTenant } from "@/lib/db";
import { formatDate, formatXof } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { daysBetween, effectiveStatus, todayCalendar } from "@/modules/subscriptions/dates";
import { REPORTS, parseReport, subscriptionReport, type ReportKind } from "@/modules/subscriptions/subscriptions.service";
import { statusVariant } from "@/components/subscriptions/subscription-panel";

type Space = "admin" | "reception";

/** Listes de suivi : à renouveler, expirés, en attente de paiement, en cours. */
export async function SubscriptionsReport({
  space,
  searchParams,
}: {
  space: Space;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSpace(space);
  if (!can(ctx.role, "subscriptions.read")) redirect(`/${space}`);
  const kind = parseReport((await searchParams).liste);
  const today = todayCalendar();
  const rows = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => subscriptionReport(tx, kind, today));
  const memberBase = `/${space}/adherents`;

  const info = (s: (typeof rows)[number]) => {
    if (kind === "a-renouveler") {
      const days = daysBetween(today, s.endDate);
      return days === 0 ? "Expire ce soir" : `Expire dans ${days} jour(s)`;
    }
    if (kind === "expires") return `Expiré depuis ${daysBetween(s.endDate, today)} jour(s)`;
    if (kind === "en-attente") return formatXof(s.priceXof);
    return `Jusqu'au ${formatDate(s.endDate)}`;
  };

  return (
    <>
      <PageHeader title="Abonnements" description="Suivi des renouvellements et des paiements en attente." />
      <nav aria-label="Listes" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {(Object.keys(REPORTS) as ReportKind[]).map((k) => (
          <Link
            key={k}
            href={`/${space}/abonnements?liste=${k}`}
            aria-current={k === kind ? "page" : undefined}
            className={cn("rounded-md px-3 py-1", k === kind ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {REPORTS[k]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucun abonnement dans cette liste.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Adhérent</th>
                <th className="px-4 py-3 font-medium">Téléphone</th>
                <th className="px-4 py-3 font-medium">Formule</th>
                <th className="px-4 py-3 font-medium">Échéance</th>
                <th className="px-4 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const status = effectiveStatus(s, today);
                return (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link href={`${memberBase}/${s.member.id}`} className="font-medium hover:underline">
                        {s.member.lastName} {s.member.firstName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{s.member.code}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatPhone(s.member.phone)}</td>
                    <td className="px-4 py-3">{s.planName}</td>
                    <td className="px-4 py-3">{info(s)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(status)}>{SUBSCRIPTION_STATUS_LABELS[status]}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Les relances automatiques (WhatsApp, SMS, e-mail) à J-7, J-3 et J0 arriveront aux Sprints 8 et 9.
      </p>
    </>
  );
}
