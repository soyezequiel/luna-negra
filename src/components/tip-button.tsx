"use client";

import { useCallback, useState } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { Button } from "@/components/ui/button";
import { payWithExtension, WebLNError } from "@/lib/webln";
import { payInvoiceWithNwc, NwcError } from "@/lib/nwc-wallet";

type Props = {
  gameId: string;
  providerName: string;
};

type Phase = "idle" | "picking" | "creating" | "pending" | "done" | "error";

// Montos sugeridos de propina (sats). El usuario también puede tipear uno propio.
const PRESETS = [100, 500, 2000] as const;

export function TipButton({ gameId, providerName }: Props) {
  const { user, login } = useSession();
  const { connected: nwcConnected, refresh: refreshWallet } = useWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [weblnError, setWeblnError] = useState<string | null>(null);
  const [nwcPaying, setNwcPaying] = useState(false);
  const [nwcError, setNwcError] = useState<string | null>(null);

  const close = useCallback(() => {
    setPhase("idle");
    setError(null);
    setInvoice(null);
    setQr(null);
    setCustom("");
    setAmount(PRESETS[0]);
    setWeblnError(null);
    setWeblnPaying(false);
    setNwcError(null);
    setNwcPaying(false);
  }, []);

  // Monto elegido: el custom (si es un entero válido) tiene prioridad sobre el preset.
  const chosenAmount = useCallback((): number | null => {
    if (custom.trim()) {
      const n = Number(custom);
      return Number.isInteger(n) && n >= 1 ? n : null;
    }
    return amount;
  }, [custom, amount]);

  const startTip = useCallback(async () => {
    const sats = chosenAmount();
    if (!sats) {
      setError("Ingresá un monto válido en sats.");
      return;
    }
    setError(null);
    setPhase("creating");
    try {
      const res = await fetch(`/api/games/${gameId}/tip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountSats: sats }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar la propina");
      setAmount(sats);
      setInvoice(data.invoice);
      setDevMode(Boolean(data.devMode));
      setQr(await QRCode.toDataURL(data.invoice, { margin: 1, width: 240 }));
      setPhase("pending");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Error al generar la propina");
    }
  }, [gameId, chosenAmount]);

  const payWithNwcClick = useCallback(async () => {
    if (!invoice) return;
    setNwcError(null);
    setNwcPaying(true);
    try {
      await payInvoiceWithNwc(invoice);
      void refreshWallet();
      // El invoice es del dev, no de la tienda: la confirmación la da el wallet.
      setPhase("done");
    } catch (e) {
      setNwcError(e instanceof NwcError ? e.message : "No se pudo pagar con el wallet NWC.");
    } finally {
      setNwcPaying(false);
    }
  }, [invoice, refreshWallet]);

  const payWithExtensionClick = useCallback(async () => {
    if (!invoice) return;
    setWeblnError(null);
    setWeblnPaying(true);
    try {
      await payWithExtension(invoice);
      setPhase("done");
    } catch (e) {
      setWeblnError(e instanceof WebLNError ? e.message : "No se pudo pagar con la extensión.");
    } finally {
      setWeblnPaying(false);
    }
  }, [invoice]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [invoice]);

  // --- Render ---

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <p className="text-sm font-semibold text-ln-text">¿Te gustó el juego?</p>
      <p className="mt-1 text-[13px] text-ln-muted">
        Dejale una propina opcional a {providerName} ⚡
      </p>
      {user ? (
        <Button
          variant="btc"
          className="mt-3 w-full"
          onClick={() => setPhase("picking")}
        >
          Dejar propina
        </Button>
      ) : (
        <Button variant="blue" className="mt-3 w-full" onClick={login}>
          Conectar para dejar propina
        </Button>
      )}

      {phase !== "idle" ? (
        <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-ln-xl border border-ln-corona/40 bg-ln-card p-6 text-center shadow-ln-modal">
            {phase === "done" ? (
              <>
                <h3 className="font-display text-lg font-bold text-white">
                  ¡Gracias! ⚡
                </h3>
                <p className="mt-2 text-sm text-ln-muted">
                  Tu propina de {amount.toLocaleString("es-AR")} sats fue enviada a{" "}
                  {providerName}.
                </p>
                <Button variant="corona" className="mt-5 w-full" onClick={close}>
                  Cerrar
                </Button>
              </>
            ) : phase === "pending" && invoice ? (
              <>
                <h3 className="font-display text-lg font-bold text-white">
                  ⚡ Propina de {amount.toLocaleString("es-AR")} sats
                </h3>
                <p className="mt-1 text-sm text-ln-corona-bright">
                  Para {providerName} · escaneá o copiá el invoice
                </p>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qr}
                    alt="QR del invoice"
                    className="mx-auto mt-4 rounded-lg bg-white p-2"
                  />
                ) : null}
                {nwcConnected ? (
                  <>
                    <Button
                      variant="corona"
                      className="mt-4 w-full"
                      onClick={payWithNwcClick}
                      disabled={nwcPaying}
                    >
                      {nwcPaying ? "Pagando…" : "⚡ Pagar con saldo (NWC)"}
                    </Button>
                    {nwcError ? (
                      <p className="mt-2 text-sm text-[var(--lose)]">{nwcError}</p>
                    ) : null}
                  </>
                ) : null}
                <Button
                  variant="btc"
                  className="mt-4 w-full"
                  onClick={payWithExtensionClick}
                  disabled={weblnPaying}
                >
                  {weblnPaying ? "Pagando…" : "⚡ Pagar con extensión (Alby)"}
                </Button>
                {weblnError ? (
                  <p className="mt-2 text-sm text-[var(--lose)]">{weblnError}</p>
                ) : null}
                <button
                  onClick={copyInvoice}
                  className="mt-4 w-full truncate rounded-sm border border-line px-3 py-2 font-mono text-xs text-muted hover:bg-white/5"
                >
                  {copied ? "¡Copiado!" : invoice}
                </button>
                {devMode ? (
                  <Button
                    variant="ghost"
                    className="mt-4 w-full"
                    onClick={() => setPhase("done")}
                  >
                    Simular pago (dev)
                  </Button>
                ) : (
                  <button
                    onClick={() => setPhase("done")}
                    className="mt-4 block w-full text-xs text-faint hover:text-ink"
                  >
                    Ya pagué desde otra wallet
                  </button>
                )}
                <button
                  onClick={close}
                  className="mt-3 text-xs text-faint hover:text-ink"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-bold text-white">
                  Dejar propina ⚡
                </h3>
                <p className="mt-1 text-sm text-ln-muted">
                  Elegí cuánto darle a {providerName}.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setAmount(p);
                        setCustom("");
                      }}
                      className={`rounded-ln-lg border px-2 py-3 text-sm font-semibold transition-colors ${
                        !custom.trim() && amount === p
                          ? "border-ln-corona/60 bg-ln-corona/15 text-ln-corona-bright"
                          : "border-ln-border text-ln-text hover:bg-white/5"
                      }`}
                    >
                      {p.toLocaleString("es-AR")}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-ln-lg border border-ln-border px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="Otro monto"
                    className="min-w-0 flex-1 bg-transparent text-sm text-ln-text outline-none placeholder:text-ln-faint"
                  />
                  <span className="text-xs text-ln-faint">sats</span>
                </div>
                {error ? (
                  <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
                ) : null}
                <Button
                  variant="corona"
                  className="mt-4 w-full"
                  onClick={startTip}
                  disabled={phase === "creating"}
                >
                  {phase === "creating" ? "Generando…" : "Continuar"}
                </Button>
                <button
                  onClick={close}
                  className="mt-3 text-xs text-faint hover:text-ink"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
