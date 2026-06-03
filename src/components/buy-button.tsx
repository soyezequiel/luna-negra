"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { priceLabel } from "@/lib/format";

type Props = {
  gameId: string;
  priceSats: number;
  owned: boolean;
  gameUrl: string | null;
};

type Phase = "idle" | "creating" | "pending" | "paid" | "error";

export function BuyButton({ gameId, priceSats, owned, gameUrl }: Props) {
  const { user, login } = useSession();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [copied, setCopied] = useState(false);
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
  }, [stopPolling]);

  const startBuy = useCallback(async () => {
    setError(null);
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

      pollRef.current = setInterval(async () => {
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
      <a href={gameUrl} target="_blank" rel="noopener noreferrer">
        <Button>Jugar</Button>
      </a>
    ) : (
      <Button variant="outline" disabled>
        En tu biblioteca
      </Button>
    );
  }

  if (!user) {
    return <Button onClick={login}>Conectar para comprar</Button>;
  }

  return (
    <>
      <Button onClick={startBuy} disabled={phase === "creating"}>
        {phase === "creating"
          ? "Generando…"
          : priceSats === 0
            ? "Obtener gratis"
            : `Comprar · ${priceLabel(priceSats)}`}
      </Button>
      {phase === "error" && error ? (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      ) : null}

      {phase === "pending" && invoice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#11141a] p-6 text-center">
            <h3 className="text-lg font-semibold">Pagá con Lightning</h3>
            <p className="mt-1 text-sm text-zinc-400">
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
            <button
              onClick={copyInvoice}
              className="mt-4 w-full truncate rounded-md border border-white/15 px-3 py-2 font-mono text-xs text-zinc-300 hover:bg-white/5"
            >
              {copied ? "¡Copiado!" : invoice}
            </button>
            <p className="mt-3 text-sm text-zinc-500">Esperando el pago…</p>

            {devMode ? (
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={simulatePay}
              >
                Simular pago (dev)
              </Button>
            ) : null}
            <button
              onClick={closeModal}
              className="mt-3 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
