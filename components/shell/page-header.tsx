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
