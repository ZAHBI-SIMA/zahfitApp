import type { ReactNode } from "react";

export function PageHeader({ title, description, children }: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Squelette de la zone de contenu, affiché par les `loading.tsx` des espaces
 * pendant qu'une page lit la session et la base. Le menu reste affiché :
 * seule la page change lors d'une navigation interne.
 */
export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="mb-6">
        <div className="h-7 w-56 rounded bg-muted" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-muted" />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function UpcomingList({ items }: { items: { sprint: number; label: string }[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-medium">Prochaines fonctionnalités</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3">
            <span className="rounded-md bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
              S{item.sprint}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
