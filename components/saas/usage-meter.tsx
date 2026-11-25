import { cn } from "@/lib/utils";
import { usageRatio } from "@/modules/saas/saas.service";

/** Jauge d'usage par rapport à la limite du forfait (alerte à 80 %, rouge à 100 %). */
export function UsageMeter({
  label,
  used,
  limit,
  hint,
  unavailable,
}: {
  label: string;
  used: number;
  limit: number | null;
  hint?: string;
  /** Module absent du forfait : pas de jauge (« 0 / 0 » ferait croire à une limite atteinte). */
  unavailable?: string;
}) {
  if (unavailable) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm">{unavailable}</p>
      </div>
    );
  }
  const ratio = usageRatio(used, limit);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm">
          <strong className="text-lg">{used}</strong>
          <span className="text-muted-foreground"> / {limit === null ? "illimité" : limit}</span>
        </p>
      </div>
      {ratio !== null && (
        <div
          className="mt-2 h-2 w-full rounded-full bg-muted"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ratio}
        >
          <div
            className={cn("h-2 rounded-full bg-brand", ratio >= 80 && "bg-amber-500", ratio >= 100 && "bg-destructive")}
            style={{ width: `${Math.max(2, ratio)}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {ratio !== null && ratio >= 100 && <p className="mt-1 text-xs text-destructive">Limite atteinte.</p>}
      {ratio !== null && ratio >= 80 && ratio < 100 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Bientôt atteinte.</p>
      )}
    </div>
  );
}
