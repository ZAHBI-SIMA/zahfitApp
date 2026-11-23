"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Field, FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import {
  issueBadgeAction,
  revokeBadgeAction,
  updateAccessSettingsAction,
  type BadgeFormState,
} from "@/modules/access/access.actions";
import { buildQrToken, dayOfWindow, WINDOW_SECONDS, windowOf } from "@/modules/access/token";

// --- QR dynamique de l'adhérent ------------------------------------------------

/**
 * Génère le QR SUR LE TÉLÉPHONE, toutes les 30 s, avec la clé du jour de
 * l'adhérent : une fois la page ouverte, plus besoin de réseau. L'horloge
 * est recalée sur celle du serveur (téléphones souvent à l'heure approximative).
 */
export function MemberQr({
  memberId,
  keys,
  serverNow,
}: {
  memberId: string;
  keys: Record<string, string>;
  serverNow: number;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(WINDOW_SECONDS);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const offset = serverNow - Date.now();
    let current = -1;
    let cancelled = false;
    const tick = async () => {
      const now = Date.now() + offset;
      setSecondsLeft(WINDOW_SECONDS - (Math.floor(now / 1000) % WINDOW_SECONDS));
      const win = windowOf(now);
      if (win === current) return;
      current = win;
      const key = keys[dayOfWindow(win)];
      if (!key) {
        setExpired(true);
        setSvg(null);
        return;
      }
      const token = await buildQrToken(key, memberId, win);
      const image = await QRCode.toString(token, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      if (!cancelled) setSvg(image);
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [memberId, keys, serverNow]);

  if (expired) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm">
        Ce QR Code a expiré.{" "}
        <button type="button" className="text-brand underline" onClick={() => location.reload()}>
          Recharger
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="aspect-square w-full max-w-72 rounded-2xl bg-white p-3 [&_svg]:size-full"
        role="img"
        aria-label="QR Code d'accès, renouvelé toutes les 30 secondes"
        // SVG produit par la bibliothèque qrcode à partir de notre jeton : aucun contenu externe.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className="h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full bg-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${(secondsLeft / WINDOW_SECONDS) * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Nouveau code dans {secondsLeft} s — une capture d&apos;écran ne fonctionne pas.
      </p>
    </div>
  );
}

// --- Badge physique ------------------------------------------------------------

function printBadge(badge: { code: string; svg: string }, holder: { name: string; code: string; tenant: string }) {
  const popup = window.open("", "_blank", "width=420,height=560");
  if (!popup) return;
  const doc = popup.document;
  doc.title = `Badge ${holder.name}`;
  const style = doc.createElement("style");
  style.textContent =
    "body{font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:24px}" +
    ".card{width:54mm;border:1px solid #ccc;border-radius:8px;padding:12px;text-align:center}" +
    ".card svg{width:100%;height:auto}.code{font-family:monospace;font-size:13px;margin-top:4px}" +
    "h1{font-size:13px;margin:0 0 8px}p{margin:2px 0;font-size:12px}";
  doc.head.appendChild(style);
  const card = doc.createElement("div");
  card.className = "card";
  const title = doc.createElement("h1");
  title.textContent = holder.tenant;
  const qr = doc.createElement("div");
  qr.innerHTML = badge.svg; // SVG généré par notre serveur (bibliothèque qrcode)
  const name = doc.createElement("p");
  name.textContent = `${holder.name} — ${holder.code}`;
  const code = doc.createElement("p");
  code.className = "code";
  code.textContent = badge.code;
  card.append(title, qr, name, code);
  doc.body.appendChild(card);
  popup.focus();
  popup.print();
}

export function BadgePanel({
  memberId,
  badge,
  holder,
  canWrite,
}: {
  memberId: string;
  badge: { hint: string; issuedAt: Date | null } | null;
  holder: { name: string; code: string; tenant: string };
  canWrite: boolean;
}) {
  const issue = useFormAction<BadgeFormState>(issueBadgeAction);
  const revoke = useFormAction<BadgeFormState>(revokeBadgeAction);
  const issued = issue.state.badge;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <FormMessage state={revoke.state.message ? revoke.state : issue.state} />
      {badge ? (
        <p>
          Badge actif <span className="font-mono">•••• {badge.hint}</span>
          {badge.issuedAt && <span className="text-muted-foreground"> — remis le {formatDateTime(badge.issuedAt)}</span>}
        </p>
      ) : (
        <p className="text-muted-foreground">Aucun badge : l&apos;adhérent entre avec le QR Code de son espace.</p>
      )}

      {issued && badge && issued.code.endsWith(badge.hint) && (
        <div className="flex items-center gap-4 rounded-xl border bg-white p-3 text-black">
          <div className="size-24 shrink-0 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: issued.svg }} />
          <div className="flex flex-col gap-2">
            <p className="font-mono text-base">{issued.code}</p>
            <Button type="button" size="sm" onClick={() => printBadge(issued, holder)}>
              Imprimer le badge
            </Button>
          </div>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(event) => {
              if (badge && !confirm("Renouveler le badge ? L'ancien sera refusé immédiatement.")) {
                event.preventDefault();
                return;
              }
              issue.onSubmit(event);
            }}
          >
            <input type="hidden" name="memberId" value={memberId} />
            <Button type="submit" size="sm" variant="outline" disabled={issue.pending}>
              {badge ? "Renouveler (perte, vol)" : "Émettre un badge"}
            </Button>
          </form>
          {badge && (
            <form
              onSubmit={(event) => {
                if (!confirm("Révoquer ce badge ? Il sera refusé à l'entrée.")) {
                  event.preventDefault();
                  return;
                }
                revoke.onSubmit(event);
              }}
            >
              <input type="hidden" name="memberId" value={memberId} />
              <Button type="submit" size="sm" variant="destructive" disabled={revoke.pending}>
                Révoquer
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// --- Réglages -----------------------------------------------------------------

export function AccessSettingsForm({ antiPassbackMinutes }: { antiPassbackMinutes: number }) {
  const { state, pending, onSubmit } = useFormAction(updateAccessSettingsAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <Field
        name="antiPassbackMinutes"
        label="Anti-passback (minutes)"
        state={state}
        hint="Délai minimal entre deux entrées d'un même adhérent : empêche de prêter son QR ou son badge. 0 = désactivé."
        className="sm:w-1/2"
      >
        <Input id="antiPassbackMinutes" name="antiPassbackMinutes" type="number" min={0} max={720} defaultValue={antiPassbackMinutes} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Les jours et créneaux autorisés se règlent sur chaque formule ; les horaires d&apos;ouverture s&apos;appliquent à
        tous les adhérents.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
