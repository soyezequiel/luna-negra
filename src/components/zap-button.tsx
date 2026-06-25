"use client";

import { useCallback, useState } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { payWithExtension, WebLNError } from "@/lib/webln";
import { payInvoiceWithNwc, NwcError } from "@/lib/nwc-wallet";
import { getActiveSigner, restoreSigner, type UnsignedEvent } from "@/lib/signer";

type Props = {
  gameId: string;
  providerName: string;
  /** Clases extra para el botón disparador (p. ej. flex-1 en una fila compacta). */
  className?: string;
};

type Phase = "idle" | "picking" | "creating" | "pending" | "done" | "error";

// Montos sugeridos de zap (sats). El usuario también puede tipear uno propio.
const PRESETS = [100, 500, 2000] as const;

/**
 * Tarjeta "Dejar un zap ⚡" de los juegos gratis. Convierte la propina en un zap
 * NIP-57 real: arma el zap request en el server (prepare), lo FIRMA con la
 * identidad Nostr del usuario (así se sabe quién mandó), pide el invoice al
 * wallet del dev (invoice) y lo paga con NWC/extensión/QR. El recibo (9735) que
 * emite el wallet del dev alimenta el top de zappers (puede tardar un tick).
 */
export function ZapButton({ gameId, providerName, className }: Props) {
  const { user, login } = useSession();
  const { connected: nwcConnected, refresh: refreshWallet } = useWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [comment, setComment] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
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
    setComment("");
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

  const startZap = useCallback(async () => {
    const sats = chosenAmount();
    if (!sats) {
      setError("Ingresá un monto válido en sats.");
      return;
    }
    setError(null);
    setPhase("creating");
    try {
      // 1) Pedir el zap request sin firmar (valida gating + monto).
      const prepRes = await fetch(`/api/games/${gameId}/zap/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountSats: sats, comment: comment.trim() || undefined }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? "No se pudo preparar el zap");

      // 2) Firmar el 9734 con la identidad Nostr del usuario.
      const signer = getActiveSigner() ?? (await restoreSigner());
      if (!signer) throw new Error("Conectá tu Nostr para zapear");
      const signed = await signer.signEvent(
        prep.unsignedZapRequest as UnsignedEvent,
      );

      // 3) Pedir el invoice al wallet del dev con el request firmado.
      const invRes = await fetch(`/api/games/${gameId}/zap/invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedZapRequest: signed }),
      });
      const inv = await invRes.json();
      if (!invRes.ok) throw new Error(inv.error ?? "No se pudo generar el invoice");

      setAmount(sats);
      setInvoice(inv.invoice);
      setQr(await QRCode.toDataURL(inv.invoice, { margin: 1, width: 240 }));
      setPhase("pending");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Error al generar el zap");
    }
  }, [gameId, chosenAmount, comment]);

  // Una vez pagado, el recibo 9735 lo levanta el sync (puede tardar un tick);
  // avisamos a la página para que refresque el top apenas aparezca.
  const announceZapped = useCallback(() => {
    window.dispatchEvent(new CustomEvent("luna:zapped", { detail: { gameId } }));
  }, [gameId]);

  const payWithNwcClick = useCallback(async () => {
    if (!invoice) return;
    setNwcError(null);
    setNwcPaying(true);
    try {
      await payInvoiceWithNwc(invoice);
      void refreshWallet();
      announceZapped();
      setPhase("done");
    } catch (e) {
      setNwcError(e instanceof NwcError ? e.message : "No se pudo pagar con el wallet NWC.");
    } finally {
      setNwcPaying(false);
    }
  }, [invoice, refreshWallet, announceZapped]);

  const payWithExtensionClick = useCallback(async () => {
    if (!invoice) return;
    setWeblnError(null);
    setWeblnPaying(true);
    try {
      await payWithExtension(invoice);
      announceZapped();
      setPhase("done");
    } catch (e) {
      setWeblnError(e instanceof WebLNError ? e.message : "No se pudo pagar con la extensión.");
    } finally {
      setWeblnPaying(false);
    }
  }, [invoice, announceZapped]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [invoice]);

  // --- Render ---

  return (
    <>
      {user ? (
        <Button
          variant="btc"
          size="sm"
          className={cn("w-full", className)}
          onClick={() => setPhase("picking")}
          title={`Dejale un zap a ${providerName} (queda público en Nostr)`}
        >
          ⚡ Dejar un zap
        </Button>
      ) : (
        <Button
          variant="btc"
          size="sm"
          className={cn("w-full", className)}
          onClick={login}
        >
          ⚡ Dejar un zap
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
                  Tu zap de {amount.toLocaleString("es-AR")} sats fue enviado a{" "}
                  {providerName}. Aparecerás en el top en unos segundos.
                </p>
                <Button variant="corona" className="mt-5 w-full" onClick={close}>
                  Cerrar
                </Button>
              </>
            ) : phase === "pending" && invoice ? (
              <>
                <h3 className="font-display text-lg font-bold text-white">
                  ⚡ Zap de {amount.toLocaleString("es-AR")} sats
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
                <button
                  onClick={() => {
                    announceZapped();
                    setPhase("done");
                  }}
                  className="mt-4 block w-full text-xs text-faint hover:text-ink"
                >
                  Ya pagué desde otra wallet
                </button>
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
                  Dejar un zap ⚡
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
                <input
                  type="text"
                  value={comment}
                  maxLength={280}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Comentario (opcional)"
                  className="mt-3 w-full rounded-ln-lg border border-ln-border bg-transparent px-3 py-2 text-sm text-ln-text outline-none placeholder:text-ln-faint"
                />
                {error ? (
                  <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
                ) : null}
                <Button
                  variant="corona"
                  className="mt-4 w-full"
                  onClick={startZap}
                  disabled={phase === "creating"}
                >
                  {phase === "creating" ? "Firmando…" : "Continuar"}
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
    </>
  );
}
