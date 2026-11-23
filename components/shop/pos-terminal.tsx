"use client";

import { useMemo, useState } from "react";
import { Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatXof } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createSaleAction, type SaleFormState } from "@/modules/shop/shop.actions";

type PosProduct = { id: string; name: string; category: string | null; priceXof: number; trackStock: boolean; stockQty: number };

/**
 * Caisse boutique de l'accueil. Le panier vit dans le navigateur, mais seuls
 * les identifiants et quantités sont envoyés : prix et stock sont vérifiés
 * par le serveur au moment de la vente.
 */
export function PosTerminal({ products }: { products: PosProduct[] }) {
  const { state, pending, onSubmit } = useFormAction<SaleFormState>(createSaleAction);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("CASH");

  // Vente enregistrée : panier vidé (une seule fois par vente), ticket proposé.
  // Ajustement pendant le rendu plutôt qu'un effet : pas de rendu intermédiaire avec l'ancien panier.
  const [handledSaleId, setHandledSaleId] = useState<string | undefined>();
  if (state.saleId && state.saleId !== handledSaleId) {
    setHandledSaleId(state.saleId);
    setCart({});
  }

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart)
    .map(([id, quantity]) => ({ product: byId.get(id)!, quantity }))
    .filter((l) => l.product);
  const total = lines.reduce((s, l) => s + l.product.priceXof * l.quantity, 0);
  const visible = products.filter((p) => `${p.name} ${p.category ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  const available = (p: PosProduct) => (p.trackStock ? p.stockQty - (cart[p.id] ?? 0) : Infinity);
  const add = (p: PosProduct) => {
    if (available(p) <= 0) return;
    setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }));
  };
  const remove = (id: string) =>
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) - 1 };
      if (next[id] <= 0) delete next[id];
      return next;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section aria-label="Articles">
        <Input
          type="search"
          placeholder="Rechercher un article…"
          aria-label="Rechercher un article"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3"
        />
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun article.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => {
              const out = available(p) <= 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    disabled={out}
                    className={cn(
                      "flex h-full w-full flex-col rounded-xl border bg-card p-3 text-left transition hover:border-brand",
                      out && "cursor-not-allowed opacity-50 hover:border-border",
                    )}
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                    <span className="mt-auto pt-2 font-semibold">{formatXof(p.priceXof)}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.trackStock ? (out ? "Rupture" : `${available(p)} disponible(s)`) : "Sans stock"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="panier" className="h-fit rounded-xl border bg-card p-4 lg:sticky lg:top-4">
        <h2 id="panier" className="mb-3 text-sm font-medium">
          Panier
        </h2>
        {state.ok && state.saleId && (
          <div role="status" className="mb-3 rounded-lg bg-green-500/10 p-3 text-sm">
            {state.message}{" "}
            <a
              href={`/api/ventes/${state.saleId}`}
              target="_blank"
              rel="noopener"
              className="font-medium text-brand hover:underline"
            >
              Imprimer le ticket
            </a>
          </div>
        )}
        {state.ok === false && <FormMessage state={state} />}

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Touchez un article pour l&apos;ajouter.</p>
        ) : (
          <ul className="mb-3 divide-y text-sm">
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  {product.name}
                  <span className="block text-xs text-muted-foreground">{formatXof(product.priceXof)} l&apos;unité</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => remove(product.id)}
                  aria-label={`Retirer un article « ${product.name} »`}
                >
                  −
                </Button>
                <span className="w-6 text-center" aria-live="polite">
                  {quantity}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => add(product)}
                  disabled={available(product) <= 0}
                  aria-label={`Ajouter un article « ${product.name} »`}
                >
                  +
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })))}
          />
          <p className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-semibold">{formatXof(total)}</span>
          </p>
          <Field name="method" label="Paiement" state={state}>
            <NativeSelect id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Espèces (entre dans la caisse)</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
              <option value="CARD">Carte bancaire</option>
              <option value="TRANSFER">Virement</option>
            </NativeSelect>
          </Field>
          {method !== "CASH" && (
            <Field name="reference" label="Référence de transaction" state={state}>
              <Input id="reference" name="reference" />
            </Field>
          )}
          <Field name="memberCode" label="Code adhérent (facultatif)" state={state} hint="Rattache l'achat à son historique.">
            <Input id="memberCode" name="memberCode" placeholder="ADH-000001" />
          </Field>
          <Button
            type="submit"
            size="lg"
            disabled={pending || lines.length === 0}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {pending ? "Enregistrement…" : `Encaisser ${formatXof(total)}`}
          </Button>
        </form>
      </section>
    </div>
  );
}
