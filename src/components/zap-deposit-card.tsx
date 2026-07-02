"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/providers/wallet-provider";
import { Button } from "@/components/ui/button";
import { payWithExtension, WebLNError } from "@/lib/webln";
import { payInvoiceWithNwc, NwcError } from "@/lib/nwc-wallet";
import { getActiveSigner, restoreSigner, type UnsignedEvent } from "@/lib/signer";

type Props = {
  betId: string;
  stakeSats: number;
};

type Phase = "idle" | "creating" | "pending" | "paid" | "error";

/**
 * Tarjeta de depósito por zap (apuestas v2). Adaptación de ZapButton: pide el zap
 * request al server (prepare), lo FIRMA con la identidad del usuario, pide el
 * invoice (invoice) y lo paga con NWC/extensión/QR. Monto fijo = stake. Tras pagar,
 * poll-ea `/mine` hasta que el depósito quede `paid` (Luna Negra publica el 9735).
 */
export function ZapDepositCard({ betId, stakeSats }: Props) {
  const { connected: nwcConnected, refresh: refreshWallet } = useWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nwcPaying, setNwcPaying] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Poll a /mine: al detectar `paid`, mostramos el recibo y frenamos.
  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v2/bets/${betId}/mine`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.depositStatus === "paid") {
          stopPolling();
          setPhase("paid");
        }
      } catch {
        /* reintenta en el próximo intervalo */
      }
    }, 2500);
  }, [betId, stopPolling]);

  const start = useCallback(async () => {
    setError(null);
    setPhase("creating");
    try {
      // 1) Zap request sin firmar (valida sesión + participante).
      const prepRes = await fetch(`/api/v2/bets/${betId}/deposit/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? "No se pudo preparar el depósito");

      // 2) Firmar el 9734 con la identidad Nostr del usuario.
      const signer = getActiveSigner() ?? (await restoreSigner());
      if (!signer) throw new Error("Conectá tu Nostr para depositar");
      const signed = await signer.signEvent(prep.unsignedZapRequest as UnsignedEvent);

      // 3) Pedir el invoice (Luna Negra lo emite con su NWC).
      const invRes = await fetch(`/api/v2/bets/${betId}/deposit/invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedZapRequest: signed }),
      });
      const inv = await invRes.json();
      if (!invRes.ok) throw new Error(inv.error ?? "No se pudo generar el invoice");

      setInvoice(inv.invoice);
      setQr(
        await QRCode.toDataURL(inv.invoice, { margin: 2, width: 288, errorCorrectionLevel: "M" }),
      );
      setPhase("pending");
      startPolling();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Error al preparar el depósito");
    }
  }, [betId, startPolling]);

  const payWithNwcClick = useCallback(async () => {
    if (!invoice) return;
    setPayError(null);
    setNwcPaying(true);
    try {
      await payInvoiceWithNwc(invoice);
      void refreshWallet();
    } catch (e) {
      setPayError(e instanceof NwcError ? e.message : "No se pudo pagar con el wallet NWC.");
    } finally {
      setNwcPaying(false);
    }
  }, [invoice, refreshWallet]);

  const payWithExtensionClick = useCallback(async () => {
    if (!invoice) return;
    setPayError(null);
    setWeblnPaying(true);
    try {
      await payWithExtension(invoice);
    } catch (e) {
      setPayError(e instanceof WebLNError ? e.message : "No se pudo pagar con la extensión.");
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

  if (phase === "paid") {
    return (
      <div className="rounded-ln-lg border border-ln-corona/40 bg-ln-corona/10 p-4 text-center">
        <p className="font-display text-sm font-bold text-ln-corona-bright">
          ✅ Depósito confirmado
        </p>
        <p className="mt-1 text-xs text-ln-muted">
          Tu zap de {stakeSats.toLocaleString("es-AR")} sats quedó registrado en Nostr.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      {phase === "idle" || phase === "creating" || phase === "error" ? (
        <>
          <p className="text-sm text-ln-text">
            Depositá tu stake de{" "}
            <span className="font-semibold text-ln-corona-bright">
              {stakeSats.toLocaleString("es-AR")} sats
            </span>{" "}
            con un zap ⚡
          </p>
          {error ? <p className="mt-2 text-sm text-[var(--lose)]">{error}</p> : null}
          <Button
            variant="corona"
            className="mt-3 w-full"
            onClick={start}
            disabled={phase === "creating"}
          >
            {phase === "creating" ? "Firmando…" : "⚡ Depositar con zap"}
          </Button>
        </>
      ) : null}

      {phase === "pending" && invoice ? (
        <div className="text-center">
          <p className="font-display text-sm font-bold text-white">
            ⚡ Depósito de {stakeSats.toLocaleString("es-AR")} sats
          </p>
          <p className="mt-1 text-xs text-ln-muted">Escaneá o copiá el invoice</p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR del invoice" className="mx-auto mt-3 rounded-lg bg-white p-2" />
          ) : null}
          {nwcConnected ? (
            <Button
              variant="corona"
              className="mt-3 w-full"
              onClick={payWithNwcClick}
              disabled={nwcPaying}
            >
              {nwcPaying ? "Pagando…" : "⚡ Pagar con saldo (NWC)"}
            </Button>
          ) : null}
          <Button
            variant="btc"
            className="mt-3 w-full"
            onClick={payWithExtensionClick}
            disabled={weblnPaying}
          >
            {weblnPaying ? "Pagando…" : "⚡ Pagar con extensión (Alby)"}
          </Button>
          {payError ? <p className="mt-2 text-sm text-[var(--lose)]">{payError}</p> : null}
          <button
            onClick={copyInvoice}
            className="mt-3 w-full truncate rounded-sm border border-line px-3 py-2 font-mono text-xs text-muted hover:bg-white/5"
          >
            {copied ? "¡Copiado!" : invoice}
          </button>
          <p className="mt-3 text-xs text-ln-faint">Esperando el pago…</p>
        </div>
      ) : null}
    </div>
  );
}
