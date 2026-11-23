"use client";

import { useEffect, useRef } from "react";
import { Checkbox, Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/validation";
import {
  adjustStockAction,
  createProductAction,
  restockAction,
  updateProductAction,
  voidSaleAction,
} from "@/modules/shop/shop.actions";

/** Vide le formulaire après un succès (sauf en modification : on garde les valeurs enregistrées). */
function useResetOnSuccess(state: FormState, enabled = true) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (enabled && state.ok) ref.current?.reset();
  }, [state, enabled]);
  return ref;
}

type ProductValues = {
  id: string;
  name: string;
  category: string | null;
  priceXof: number;
  costXof: number | null;
  trackStock: boolean;
  lowStockThreshold: number;
  isActive: boolean;
};

/** Création (sans `product`) ou modification d'un article du catalogue. */
export function ProductForm({ product }: { product?: ProductValues }) {
  const { state, pending, onSubmit } = useFormAction(product ? updateProductAction : createProductAction);
  const ref = useResetOnSuccess(state, !product);
  const id = (name: string) => `${name}-${product?.id ?? "new"}`;
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      {product && <input type="hidden" name="productId" value={product.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="name" label="Nom *" state={state} className="sm:col-span-2">
          <Input id={id("name")} name="name" defaultValue={product?.name} required />
        </Field>
        <Field name="category" label="Catégorie" state={state}>
          <Input id={id("category")} name="category" defaultValue={product?.category ?? ""} placeholder="Boissons, textile…" />
        </Field>
        <Field name="priceXof" label="Prix de vente (FCFA) *" state={state}>
          <Input id={id("priceXof")} name="priceXof" inputMode="numeric" defaultValue={product?.priceXof} required />
        </Field>
        <Field name="costXof" label="Prix d'achat (FCFA)" state={state}>
          <Input id={id("costXof")} name="costXof" inputMode="numeric" defaultValue={product?.costXof ?? ""} />
        </Field>
        <Field name="lowStockThreshold" label="Alerte stock à" state={state}>
          <Input
            id={id("lowStockThreshold")}
            name="lowStockThreshold"
            inputMode="numeric"
            defaultValue={product?.lowStockThreshold ?? 3}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox name="trackStock" label="Suivre le stock" defaultChecked={product?.trackStock ?? true} />
        <Checkbox name="isActive" label="En vente" defaultChecked={product?.isActive ?? true} />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : product ? "Enregistrer" : "Ajouter le produit"}
        </Button>
      </div>
    </form>
  );
}

export function RestockForm({ productId }: { productId: string }) {
  const { state, pending, onSubmit } = useFormAction(restockAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-2 sm:grid-cols-[90px_120px_1fr_auto] sm:items-end">
        <Field name="quantity" label="Quantité" state={state}>
          <Input id={`rq-${productId}`} name="quantity" inputMode="numeric" required />
        </Field>
        <Field name="unitCostXof" label="Coût unitaire" state={state}>
          <Input id={`rc-${productId}`} name="unitCostXof" inputMode="numeric" />
        </Field>
        <Field name="reason" label="Fournisseur / bon" state={state}>
          <Input id={`rr-${productId}`} name="reason" />
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Réceptionner
        </Button>
      </div>
    </form>
  );
}

export function AdjustStockForm({ productId }: { productId: string }) {
  const { state, pending, onSubmit } = useFormAction(adjustStockAction);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-2 sm:grid-cols-[90px_1fr_auto] sm:items-end">
        <Field name="quantity" label="Écart (±)" state={state}>
          <Input id={`aq-${productId}`} name="quantity" placeholder="-2" required />
        </Field>
        <Field name="reason" label="Motif" state={state}>
          <Input id={`ar-${productId}`} name="reason" placeholder="Inventaire, casse, péremption…" required />
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Ajuster
        </Button>
      </div>
    </form>
  );
}

export function VoidSaleForm({ saleId }: { saleId: string }) {
  const { state, pending, onSubmit } = useFormAction(voidSaleAction);
  return (
    <form
      onSubmit={(event) => {
        if (
          !confirm(
            "Annuler cette vente ? Les articles reviennent en stock ; payée en espèces, la somme sort de la caisse ouverte.",
          )
        ) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <FormMessage state={state} />
      <input type="hidden" name="saleId" value={saleId} />
      <div className="flex gap-2">
        <Input
          id={`void-${saleId}`}
          name="reason"
          placeholder="Motif (retour, erreur…)"
          aria-label="Motif de l'annulation"
          required
        />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
