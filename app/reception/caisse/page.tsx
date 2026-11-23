import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CashPanel } from "@/components/cash/cash-panel";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { formatDateTime, formatXof } from "@/lib/format";
import { currentCashView, listCashSessions } from "@/modules/cash/cash.service";

export const metadata: Metadata = { title: "Caisse" };

export default async function ReceptionCashPage() {
  const ctx = await requireSpace("reception");
  if (!can(ctx.role, "cash.operate")) redirect("/reception");
  const { view, last } = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    view: await currentCashView(tx),
    last: (await listCashSessions(tx, 1))[0] ?? null,
  }));
  return (
    <>
      <PageHeader title="Caisse" description="Espèces de l'accueil : ouverture, mouvements et clôture du service." />
      {!view && last?.closedAt && (
        <p className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm">
          Dernière clôture le {formatDateTime(last.closedAt)} par {last.closedByName} : compté{" "}
          {formatXof(last.countedXof ?? 0)}, écart <strong>{formatXof(last.differenceXof ?? 0)}</strong> —{" "}
          {last.status === "VALIDATED" ? "validée par le gérant." : "en attente de validation par le gérant."}
        </p>
      )}
      <CashPanel view={view} canOperate />
    </>
  );
}
