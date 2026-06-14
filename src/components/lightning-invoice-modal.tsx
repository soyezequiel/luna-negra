"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/providers/notifications-provider";
import { satsLabel } from "@/lib/format";

type Props = {
  /** Factura BOLT11 a pagar. */
  bolt11: string;
  amountSats: number;
  /** Título (juego). */
  title: string;
  /** Subtítulo (p. ej. "vs Rival"). */
  subtitle?: string;
  /** Cuenta regresiva ya formateada (mm:ss); null si no hay deadline. */
  countdown?: string | null;
  /** Confirmar depósito ("Ya pagué"). */
  onConfirm?: () => void;
  confirming?: boolean;
  /** Pago con extensión WebLN (Alby). */
  onPayExtension?: () => void;
  paying?: boolean;
  payError?: string | null;
  /** Pago con el saldo del wallet NWC del navegador. */
  onPayNwc?: () => void;
  payingNwc?: boolean;
  payNwcError?: string | null;
  /** Modo dev: simular depósito. */
  devMode?: boolean;
  onSimulate?: () => void;
  onClose: () => void;
};

/**
 * Modal de factura Lightning para depósitos de apuesta (escrow). Genera el QR
 * real del BOLT11 que devuelve el backend. La confirmación real del pago la hace
 * el polling del que abre el modal; "Ya pagué" sólo fuerza un refresh optimista.
 */
export function LightningInvoiceModal({
  bolt11,
  amountSats,
  title,
  subtitle,
  countdown,
  onConfirm,
  confirming,
  onPayExtension,
  paying,
  payError,
  onPayNwc,
  payingNwc,
  payNwcError,
  devMode,
  onSimulate,
  onClose,
}: Props) {
  const { notify } = useNotify();
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(bolt11, { margin: 1, width: 200 })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bolt11]);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyInvoice() {
    try {
      await navigator.clipboard.writeText(bolt11);
      notify({ title: "Factura copiada" });
    } catch {
      notify({ title: "No se pudo copiar" });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[92] flex items-center justify-center bg-[rgba(3,2,6,.74)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[362px] max-w-full rounded-ln-xl border border-ln-corona/40 bg-ln-card p-6 shadow-ln-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 text-ln-muted transition-colors hover:text-white"
        >
          ✕
        </button>

        {/* Header */}
        <h3 className="font-display text-lg font-bold text-white">
          ⚡ Depósito de apuesta
        </h3>
        <p className="mt-0.5 text-[13px] text-ln-muted">
          {title}
          {subtitle ? ` · ${subtitle}` : ""}
        </p>

        {/* Monto */}
        <div className="mt-4 text-center">
          <p className="ln-label">Pagá exactamente</p>
          <p className="mt-1 font-mono text-3xl font-bold text-ln-corona-bright">
            {satsLabel(amountSats)}{" "}
            <span className="text-base text-ln-corona">sats</span>
          </p>
        </div>

        {/* QR sobre card blanca con logo ⚡ */}
        <div className="mx-auto mt-4 flex h-[200px] w-[200px] items-center justify-center rounded-ln-md bg-white p-2">
          {qr ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR de la factura Lightning" />
              <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-base text-ln-corona shadow">
                ⚡
              </span>
            </div>
          ) : (
            <span className="text-xs text-ln-faint">Generando QR…</span>
          )}
        </div>

        {/* Esperando el pago */}
        <div className="mt-3 flex items-center justify-center gap-2 text-[13px] text-ln-soft">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ln-ping rounded-full bg-ln-aurora" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ln-aurora" />
          </span>
          Esperando el pago
          {countdown ? (
            <span className="font-mono text-ln-faint">· {countdown}</span>
          ) : null}
        </div>

        {/* bolt11 + copiar */}
        <div className="mt-3 flex items-center gap-2 rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ln-muted">
            {bolt11}
          </code>
          <button
            onClick={copyInvoice}
            className="shrink-0 text-[11px] font-medium text-ln-corona hover:underline"
          >
            Copiar
          </button>
        </div>

        {payError ? (
          <p className="mt-2 text-center text-sm text-ln-danger">{payError}</p>
        ) : null}
        {payNwcError ? (
          <p className="mt-2 text-center text-sm text-ln-danger">{payNwcError}</p>
        ) : null}

        {/* Acciones */}
        <div className="mt-4 space-y-2">
          {onPayNwc ? (
            <Button
              variant="corona"
              className="w-full"
              onClick={onPayNwc}
              disabled={payingNwc}
            >
              {payingNwc ? "Pagando…" : "⚡ Pagar con saldo (NWC)"}
            </Button>
          ) : null}
          {onPayExtension ? (
            <Button
              variant="corona"
              className="w-full"
              onClick={onPayExtension}
              disabled={paying}
            >
              {paying ? "Pagando…" : "⚡ Pagar con extensión (Alby)"}
            </Button>
          ) : null}
          <a href={`lightning:${bolt11}`} className="btn btn-ghost w-full">
            ⚡ Abrir en wallet
          </a>
          {onConfirm ? (
            <Button
              variant="aurora"
              className="w-full"
              onClick={onConfirm}
              disabled={confirming}
            >
              {confirming ? "Confirmando…" : "Ya pagué — confirmar"}
            </Button>
          ) : null}
          {devMode && onSimulate ? (
            <Button variant="ghost" className="w-full" onClick={onSimulate}>
              Simular depósito (dev)
            </Button>
          ) : null}
        </div>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-ln-faint">
          Los sats quedan en escrow hasta el resultado. Si la sala no se completa,
          se reembolsan automáticamente.
        </p>
      </div>
    </div>
  );
}
