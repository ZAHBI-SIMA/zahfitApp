import { PayInvoiceButton } from "@/components/billing/billing-forms";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatXof } from "@/lib/format";
import type { SaasInvoiceKind, SaasInvoiceStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

type Invoice = {
  id: string;
  number: string;
  kind: SaasInvoiceKind;
  planName: string;
  status: SaasInvoiceStatus;
  amountXof: number;
  issuedOn: Date;
  dueOn: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
};

/** Factures ZahDigit d'une salle : PDF, statut, et bouton de paiement si autorisé. */
export function InvoiceList({ invoices, canPay, today }: { invoices: Invoice[]; canPay: boolean; today: Date }) {
  if (invoices.length === 0) {
    return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune facture.</div>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {invoices.map((i) => {
        const late = i.status === "OPEN" && i.dueOn < today;
        return (
          <li key={i.id} className={cn("rounded-xl border bg-card p-4", i.status === "VOID" && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  <a
                    href={`/api/factures-zahdigit/${i.id}`}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-brand hover:underline"
                  >
                    {i.number}
                  </a>{" "}
                  · {i.kind === "SETUP" ? "Installation" : "Abonnement"} {i.planName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Émise le {formatDate(i.issuedOn)} · échéance {formatDate(i.dueOn)}
                  {i.periodStart && i.periodEnd && (
                    <>
                      {" "}
                      · du {formatDate(i.periodStart)} au {formatDate(i.periodEnd)}
                    </>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className={cn("text-lg font-semibold", i.status === "VOID" && "line-through")}>{formatXof(i.amountXof)}</p>
                <Badge
                  variant={i.status === "PAID" ? "secondary" : late ? "destructive" : i.status === "VOID" ? "outline" : "default"}
                >
                  {i.status === "PAID" ? "Réglée" : i.status === "VOID" ? "Annulée" : late ? "En retard" : "À régler"}
                </Badge>
              </div>
            </div>
            {i.status === "OPEN" && canPay && (
              <div className="mt-3">
                <PayInvoiceButton invoiceId={i.id} amountLabel={formatXof(i.amountXof)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
