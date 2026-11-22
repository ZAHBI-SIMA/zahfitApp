import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-bold tracking-tight", className)}>
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-black text-brand-foreground"
      >
        Z
      </span>
      ZAHFIT
    </span>
  );
}
