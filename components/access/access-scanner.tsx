"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { ACCESS_METHOD_LABELS, ACCESS_REASON_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { accessSnapshotAction, checkAccessAction, syncAccessEventsAction } from "@/modules/access/access.actions";
import type { ScanResult } from "@/modules/access/types";
import { decideOffline, dequeue, enqueue, loadQueue, loadSnapshot, noteOnlineGrant, saveSnapshot } from "./offline-store";

/**
 * Écran de scan de l'accueil. Trois entrées possibles :
 *  - douchette USB : elle « tape » le contenu du code puis Entrée dans le champ ;
 *  - caméra du téléphone ou de la tablette ;
 *  - saisie manuelle du code d'un badge.
 * En ligne, le serveur décide (< 1 s) ; sans réseau, ou s'il ne répond pas
 * en 3 s, l'appareil décide avec son cache et met le passage en file.
 */

const ONLINE_TIMEOUT_MS = 3000;
const SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
const SYNC_EVERY_MS = 60_000;
const SAME_CODE_COOLDOWN_MS = 4000;

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

function reasonLabel(result: Pick<ScanResult, "reason" | "antiPassbackMinutes">) {
  return result.reason === "PASSBACK"
    ? `Déjà entré il y a moins de ${result.antiPassbackMinutes} min`
    : ACCESS_REASON_LABELS[result.reason];
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function AccessScanner({
  tenantId,
  initialCounts,
}: {
  tenantId: string;
  initialCounts: { granted: number; denied: number };
}) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [counts, setCounts] = useState(initialCounts);
  const [online, setOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [cacheInfo, setCacheInfo] = useState<{ at: string; members: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inFlight = useRef(false);
  const lastCode = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const audio = useRef<AudioContext | null>(null);

  const beep = useCallback((granted: boolean) => {
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = granted ? 880 : 220;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (granted ? 0.15 : 0.45));
    } catch {
      // Pas de son disponible : l'affichage suffit.
    }
  }, []);

  const refreshCacheInfo = useCallback(() => {
    const snapshot = loadSnapshot(tenantId);
    setCacheInfo(snapshot ? { at: snapshot.generatedAt, members: snapshot.members.length } : null);
    setQueueSize(loadQueue(tenantId).length);
  }, [tenantId]);

  /** Envoie la file d'attente, PUIS rafraîchit le cache (qui inclut alors ces passages). */
  const sync = useCallback(async () => {
    if (!navigator.onLine) return refreshCacheInfo();
    try {
      const queue = loadQueue(tenantId);
      for (let i = 0; i < queue.length; i += 500) {
        const chunk = queue.slice(i, i + 500);
        const sent = await syncAccessEventsAction(chunk);
        if (!sent.ok) break;
        dequeue(tenantId, new Set(chunk.map((e) => e.clientEventId)));
      }
      const snapshot = loadSnapshot(tenantId);
      const stale = !snapshot || Date.now() - Date.parse(snapshot.generatedAt) > SNAPSHOT_MAX_AGE_MS;
      if (stale || queue.length > 0) {
        const fresh = await accessSnapshotAction();
        if (fresh.ok) saveSnapshot(fresh.data);
      }
    } catch {
      // Réseau coupé pendant la synchronisation : nouvel essai au prochain cycle.
    }
    refreshCacheInfo();
  }, [tenantId, refreshCacheInfo]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      void sync();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = setInterval(() => void sync(), SYNC_EVERY_MS);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(timer);
    };
  }, [sync]);

  const handle = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      const clientEventId = crypto.randomUUID();
      let scan: ScanResult | null = null;
      let refused: string | null = null;

      if (navigator.onLine) {
        try {
          const response = await withTimeout(checkAccessAction(text, clientEventId), ONLINE_TIMEOUT_MS);
          if (response.ok) {
            scan = response.data;
            if (scan.granted) noteOnlineGrant(tenantId, scan);
          } else refused = response.message;
        } catch {
          // Pas de réponse : décision locale. Si le serveur a quand même enregistré
          // le passage, le même clientEventId évitera le doublon à la synchronisation.
        }
      }
      if (!scan && !refused) {
        const snapshot = loadSnapshot(tenantId);
        if (snapshot) {
          const offline = await decideOffline(snapshot, text, clientEventId);
          enqueue(tenantId, offline.event);
          scan = offline.result;
        } else {
          refused = "Hors ligne et aucun cache des droits sur cet appareil : vérifiez la connexion.";
        }
      }
      setOnline(navigator.onLine);

      if (scan) {
        const done = scan;
        setResult(done);
        setHistory((h) => [done, ...h].slice(0, 12));
        setCounts((c) => (done.granted ? { ...c, granted: c.granted + 1 } : { ...c, denied: c.denied + 1 }));
        beep(done.granted);
      } else {
        setResult(null);
        setError(refused);
        beep(false);
      }
      refreshCacheInfo();
      inFlight.current = false;
      setBusy(false);
      inputRef.current?.focus();
    },
    [tenantId, refreshCacheInfo, beep],
  );

  // --- Caméra ----------------------------------------------------------------
  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled || !videoRef.current) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        // BarcodeDetector (Android, macOS) sinon jsQR, chargé à la demande.
        const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
        const jsQR = detector ? null : (await import("jsqr")).default;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        timer = setInterval(async () => {
          if (inFlight.current || video.readyState < 2) return;
          let text: string | null = null;
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            const scale = Math.min(1, 480 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
          if (!text) return;
          const now = Date.now();
          if (text === lastCode.current.text && now - lastCode.current.at < SAME_CODE_COOLDOWN_MS) return;
          lastCode.current = { text, at: now };
          void handle(text);
        }, 250);
      } catch {
        setCameraError("Caméra indisponible : autorisez-la dans le navigateur, ou utilisez la douchette.");
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraOn, handle]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 font-medium",
              online ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900",
            )}
          >
            {online ? "En ligne" : "Hors ligne : décisions sur l'appareil"}
          </span>
          {queueSize > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">{queueSize} passage(s) à synchroniser</span>
          )}
          <span className="text-muted-foreground">
            {cacheInfo
              ? `Cache des droits : ${cacheInfo.members} adhérent(s), mis à jour à ${timeOf(cacheInfo.at)}`
              : "Cache des droits : en préparation…"}
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = inputRef.current?.value ?? "";
            if (inputRef.current) inputRef.current.value = "";
            void handle(value);
          }}
          className="flex gap-2"
        >
          <Input
            ref={inputRef}
            name="credential"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label="Code scanné"
            placeholder="Scannez (douchette) ou tapez le code du badge"
            className="h-11 font-mono"
          />
          <Button type="submit" className="h-11" disabled={busy}>
            Vérifier
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setCameraOn((on) => !on)}>
            {cameraOn ? "Arrêter la caméra" : "Scanner avec la caméra"}
          </Button>
          {cameraError && <p className="text-xs text-destructive">{cameraError}</p>}
        </div>
        {cameraOn && (
          <video ref={videoRef} muted playsInline className="aspect-video w-full max-w-md rounded-xl bg-black object-cover" />
        )}

        <ScanPanel result={result} error={error} busy={busy} />
      </div>

      <aside className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Entrées aujourd&apos;hui</p>
            <p className="text-2xl font-semibold">{counts.granted}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Refus</p>
            <p className="text-2xl font-semibold">{counts.denied}</p>
          </div>
        </div>
        <section className="rounded-xl border bg-card p-4" aria-labelledby="derniers-passages">
          <h2 id="derniers-passages" className="mb-2 text-sm font-medium">
            Derniers passages (cet appareil)
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun scan pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {history.map((h, i) => (
                <li key={`${h.occurredAt}-${i}`} className="flex items-start justify-between gap-2">
                  <span>
                    <span
                      aria-hidden
                      className={cn("mr-1.5 inline-block size-2 rounded-full", h.granted ? "bg-emerald-500" : "bg-red-500")}
                    />
                    {h.member?.name ?? "Inconnu"}
                    <span className="block text-xs text-muted-foreground">{reasonLabel(h)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeOf(h.occurredAt)}
                    {h.offline && " · hors ligne"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function ScanPanel({ result, error, busy }: { result: ScanResult | null; error: string | null; busy: boolean }) {
  if (busy) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border text-muted-foreground">Vérification…</div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="flex min-h-48 items-center justify-center rounded-2xl bg-red-600 p-6 text-center text-lg font-semibold text-white"
      >
        {error}
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
        En attente d&apos;un scan
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        "flex min-h-48 flex-col gap-4 rounded-2xl p-6 text-white sm:flex-row sm:items-center",
        result.granted ? "bg-emerald-600" : "bg-red-600",
      )}
    >
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 text-3xl font-semibold">
        {result.member?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo d'adhérent, URL quelconque
          <img src={result.member.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          (result.member && initials(result.member.name)) || "?"
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-bold">{result.granted ? "ACCÈS AUTORISÉ" : "ACCÈS REFUSÉ"}</p>
        {!result.granted && <p className="text-lg font-medium">{reasonLabel(result)}</p>}
        {result.member && (
          <p className="text-lg">
            {result.member.name} <span className="font-mono text-sm opacity-80">{result.member.code}</span>
          </p>
        )}
        {result.subscription && (
          <p className="text-sm opacity-90">
            {result.subscription.planName} · jusqu&apos;au {formatDate(new Date(`${result.subscription.endDate}T00:00:00Z`))}
            {result.subscription.entriesLeft !== null && ` · ${result.subscription.entriesLeft} entrée(s) restante(s)`}
          </p>
        )}
        <p className="text-xs opacity-80">
          {ACCESS_METHOD_LABELS[result.method]}
          {result.offline && " · décidé hors ligne, sera synchronisé"}
        </p>
      </div>
    </div>
  );
}
