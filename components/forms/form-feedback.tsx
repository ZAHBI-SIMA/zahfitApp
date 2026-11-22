import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/validation";
import { cn } from "@/lib/utils";

/** Message global d'un formulaire (succès ou erreur). */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <Alert variant={state.ok ? "default" : "destructive"} role={state.ok ? "status" : "alert"}>
      <AlertDescription className={cn(state.ok && "text-foreground")}>{state.message}</AlertDescription>
    </Alert>
  );
}

/** Champ libellé + message d'erreur relié pour les lecteurs d'écran. */
export function Field({
  name,
  label,
  state,
  hint,
  className,
  children,
}: {
  name: string;
  label: string;
  state: FormState;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const errors = state.errors?.[name];
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && !errors && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} id={`${name}-error`} className="text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

/** <select> natif aux couleurs du thème (accessible et léger sur mobile). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ label, ...props }: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--brand)]" {...props} />
      {label}
    </label>
  );
}
