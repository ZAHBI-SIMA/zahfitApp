import { CashMovementForm, CloseCashForm, OpenCashForm } from "@/components/cash/cash-forms";
import { StatCard } from "@/components/shell/page-header";
import { formatDateTime, formatXof } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CASH_MOVEMENT_LABELS, type currentCashView } from "@/modules/cash/cash.service";

type CashView = Awaited<ReturnType<typeof currentCashView>>;

/**
 * Caisse du jour, partagée par l'accueil et l'administration. Au moment de
 * la clôture, le théorique n'apparaît que dans l'indication du champ :
 * on compte d'abord, on compare ensuite.
 */
export function CashPanel({ view, canOperate }: { view: CashView; canOperate: boolean }) {
  if (!view) {
    return (
      <section className="rounded-xl border bg-card p-5" aria-labelledby="caisse-fermee">
        <h2 id="caisse-fermee" className="mb-1 text-sm font-medium">
          Caisse fermée
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Ouvrez la caisse en début de service, après avoir compté le fond.
        </p>
        {canOperate ? <OpenCashForm /> : <p className="text-sm text-muted-foreground">Aucune caisse ouverte.</p>}
      </section>
    );
  }

  const { session, balance, movements } = view;
  const totalIn = movements.filter((m) => m.amountXof > 0).reduce((s, m) => s + m.amountXof, 0);
  const totalOut = movements.filter((m) => m.amountXof < 0).reduce((s, m) => s - m.amountXof, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Ouverte le {formatDateTime(session.openedAt)} par {session.openedByName}.
      </p>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Fond initial" value={formatXof(session.openingFloatXof)} />
        <StatCard label="Entrées" value={formatXof(totalIn)} />
        <StatCard label="Sorties" value={formatXof(totalOut)} />
        <StatCard label="Théorique en caisse" value={formatXof(balance)} />
      </div>

      {canOperate && (
        <section className="rounded-xl border bg-card p-5" aria-labelledby="mouvement">
          <h2 id="mouvement" className="mb-1 text-sm font-medium">
            Apport ou retrait
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Les encaissements en espèces, remboursements et dépenses payées en espèces s&apos;ajoutent automatiquement.
          </p>
          <CashMovementForm />
        </section>
      )}

      <section aria-labelledby="mouvements-du-jour">
        <h2 id="mouvements-du-jour" className="mb-2 text-sm font-medium">
          Mouvements ({movements.length})
        </h2>
        {movements.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun mouvement pour l&apos;instant.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Heure</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Libellé</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Par</th>
                  <th className="px-4 py-3 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                    <td className="px-4 py-2">{CASH_MOVEMENT_LABELS[m.kind]}</td>
                    <td className="px-4 py-2">{m.label}</td>
                    <td className="hidden px-4 py-2 md:table-cell">{m.createdByName}</td>
                    <td className={cn("px-4 py-2 text-right whitespace-nowrap", m.amountXof < 0 && "text-destructive")}>
                      {m.amountXof > 0 ? "+" : "−"}
                      {formatXof(Math.abs(m.amountXof))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canOperate && (
        <section className="rounded-xl border bg-card p-5" aria-labelledby="cloture">
          <h2 id="cloture" className="mb-1 text-sm font-medium">
            Clôture
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            En fin de service : comptez les espèces, saisissez le total. Le gérant validera ensuite.
          </p>
          <CloseCashForm expectedLabel={formatXof(balance)} />
        </section>
      )}
    </div>
  );
}
