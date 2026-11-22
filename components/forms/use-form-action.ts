"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { FormState } from "@/lib/validation";

/**
 * Branche une Server Action sur un formulaire SANS la réinitialisation
 * automatique de React 19 (`<form action>` vide les champs après chaque
 * soumission, même en cas d'erreur de validation : la saisie serait perdue).
 */
export function useFormAction<S extends FormState>(
  action: (state: S, formData: FormData) => Promise<S>,
  initialState: S = {} as S,
) {
  // Nos états sont des objets simples (jamais des Promise) : Awaited<S> ≡ S.
  const [state, dispatch, pending] = useActionState<S, FormData>(
    action as (state: Awaited<S>, formData: FormData) => Promise<S>,
    initialState as Awaited<S>,
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(formData));
  };

  return { state, pending, onSubmit };
}
