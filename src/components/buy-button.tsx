"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { Button } from "@/components/ui/button";
import { PlayButton } from "@/components/play-button";
import { priceLabel } from "@/lib/format";
import { payWithExtension, WebLNError } from "@/lib/webln";
import { payInvoiceWithNwc, NwcError } from "@/lib/nwc-wallet";

type Props = {
  gameId: string;
  priceSats: number;
  owned: boolean;
  gameUrl: string | null;
  title?: string;
  slug?: string;
};

type Phase = "idle" | "creating" | "pending" | "paid" | "error";

export function BuyButton({ gameId, priceSats, owned, gameUrl, title, slug }: Props) {
  const { user, login } = useSession();
  const { connected: nwcConnected, refresh: refreshWallet } = useWallet();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [weblnError, setWeblnError] = useState<string | null>(null);
  const [nwcPaying, setNwcPaying] = useState(false);
  const [nwcError, setNwcError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const closeModal = useCallback(() => {
    stopPolling();
    setPhase("idle");
    setInvoice(null);
    setQr(null);
    setPurchaseId(null);
    setError(null);
    setExpired(false);
    setWeblnError(null);
    setWeblnPaying(false);
    setNwcError(null);
    setNwcPaying(false);
  }, [stopPolling]);

  const payWithExtensionClick = useCallback(async () => {
    if (!invoice) return;
    setWeblnError(null);
    setWeblnPaying(true);
    try {
      await payWithExtension(invoice);
      // El éxito lo confirma el polling de estado (status → paid).
    } catch (e) {
      setWeblnError(e instanceof WebLNError ? e.message : "No se pudo pagar con la extensión.");
    } finally {
      setWeblnPaying(false);
    }
  }, [invoice]);

  const payWithNwcClick = useCallback(async () => {
    if (!invoice) return;
    setNwcError(null);
    setNwcPaying(true);
    try {
      await payInvoiceWithNwc(invoice);
      void refreshWallet();
      // El éxito lo confirma el polling de estado (status → paid).
    } catch (e) {
      setNwcError(e instanceof NwcError ? e.message : "No se pudo pagar con el wallet NWC.");
    } finally {
      setNwcPaying(false);
    }
  }, [invoice, refreshWallet]);

  const startBuy = useCallback(async () => {
    setError(null);
    setExpired(false);
    setPhase("creating");
    try {
      const res = await fetch(`/api/games/${gameId}/buy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo iniciar la compra");

      if (data.status === "paid") {
        setPhase("paid");
        router.refresh();
        return;
      }

      setPurchaseId(data.purchaseId);
      setInvoice(data.invoice);
      setDevMode(Boolean(data.devMode));
      setQr(await QRCode.toDataURL(data.invoice, { margin: 1, width: 240 }));
      setPhase("pending");

      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 15 * 60 * 1000) {
          stopPolling();
          setExpired(true);
          return;
        }
        const s = await fetch(`/api/purchases/${data.purchaseId}/status`)
          .then((r) => r.json())
          .catch(() => null);
        if (s?.status === "paid") {
          stopPolling();
          setPhase("paid");
          router.refresh();
        }
      }, 3000);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Error en la compra");
    }
  }, [gameId, router, stopPolling]);

  const simulatePay = useCallback(async () => {
    if (!purchaseId) return;
    await fetch(`/api/purchases/${purchaseId}/dev-pay`, { method: "POST" });
  }, [purchaseId]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [invoice]);

  // --- Render ---

  if (owned || phase === "paid") {
    return gameUrl ? (
      <PlayButton
        gameId={gameId}
        gameUrl={gameUrl}
        title={title}
        slug={slug}
        variant="play"
      />
    ) : (
      <Button variant="ghost" disabled>
        En tu biblioteca
      </Button>
    );
  }

  if (!user) {
    return (
      <Button variant="blue" onClick={login}>
        Conectar para comprar
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={priceSats === 0 ? "play" : "btc"}
        onClick={startBuy}
        disabled={phase === "creating"}
      >
        {phase === "creating"
          ? "Generando…"
          : priceSats === 0
            ? "Agregar a la biblioteca"
            : `⚡ Comprar con Lightning`}
      </Button>
      {phase === "error" && error ? (
        <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
      ) : null}

      {phase === "pending" && invoice ? (
        <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-ln-xl border border-ln-corona/40 bg-ln-card p-6 text-center shadow-ln-modal">
            <h3 className="font-display text-lg font-bold text-white">
              ⚡ Pagá con Lightning
            </h3>
            <p className="mt-1 text-sm text-ln-corona-bright">
              {priceLabel(priceSats)} · escaneá o copiá el invoice
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
            {expired ? (
              <div className="mt-3">
                <p className="text-sm text-btc">Invoice expirado.</p>
                <Button
                  variant="btc"
                  className="mt-2 w-full"
                  onClick={startBuy}
                >
                  Reintentar
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">Esperando el pago…</p>
            )}

            {devMode ? (
              <Button
                variant="ghost"
                className="mt-4 w-full"
                onClick={simulatePay}
              >
                Simular pago (dev)
              </Button>
            ) : null}
            <button
              onClick={closeModal}
              className="mt-3 text-xs text-faint hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
