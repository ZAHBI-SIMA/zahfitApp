"use client";

import { FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { finishOnboardingAction, skipOnboardingStepAction } from "@/modules/onboarding/onboarding.actions";

export function SkipStepButton({ step }: { step: string }) {
  const { state, pending, onSubmit } = useFormAction(skipOnboardingStepAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="step" value={step} />
      <div>
        <Button type="submit" variant="ghost" size="sm" disabled={pending}>
          Passer cette étape
        </Button>
      </div>
    </form>
  );
}

export function FinishOnboardingButton({ ready }: { ready: boolean }) {
  const { state, pending, onSubmit } = useFormAction(finishOnboardingAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending} variant={ready ? "default" : "outline"}>
          {pending ? "Un instant…" : "Terminer la mise en route"}
        </Button>
      </div>
    </form>
  );
}
