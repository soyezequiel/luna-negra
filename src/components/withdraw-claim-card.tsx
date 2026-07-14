"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { satsLabel } from "@/lib/format";

function countdownLabel(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function WithdrawClaimCard({
  token,
  lnurl,
  amountSats,
  deadline,
}: {
  token: string;
  lnurl: string;
  amountSats: number;
  deadline: string;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(deadline).getTime() - Date.now()),
  );

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(lnurl.toUpperCase(), {
      margin: 2,
      width: 360,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lnurl]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining(Math.max(0, new Date(deadline).getTime() - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);

  // El endpoint deja de responder `withdrawRequest` apenas la wallet reclama el
  // premio. Recién entonces refrescamos la página para mostrar el estado final.
  useEffect(() => {
    if (new Date(deadline).getTime() <= Date.now()) return;
    const id = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/escrow/lnurlw/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as { tag?: string } | null;
        if (data?.tag !== "withdrawRequest") router.refresh();
      } catch {
        /* un fallo transitorio no invalida el QR; el próximo poll reintenta */
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [deadline, router, token]);

  async function copyLnurl() {
    try {
      await navigator.clipboard.writeText(lnurl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const expired = remaining === 0;

  return (
    <section className="rounded-ln-xl border border-ln-corona/40 bg-ln-card p-5 text-center shadow-ln-corona sm:p-6">
      <p className="ln-label text-ln-corona">Premio listo para retirar</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold text-white">
        Escaneá para cobrar
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ln-muted">
        Abrí una wallet Lightning compatible con LNURL-withdraw y escaneá este QR.
        No necesitás conectar NWC ni configurar una Lightning Address.
      </p>

      <p className="mt-4 font-mono text-3xl font-bold text-ln-corona-bright">
        {satsLabel(amountSats)} <span className="text-base text-ln-corona">sats</span>
      </p>

      <div className="relative mx-auto mt-4 flex h-[248px] w-[248px] items-center justify-center overflow-hidden rounded-ln-lg bg-white p-2">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR LNURL para retirar el premio" className="h-full w-full" />
        ) : qrError ? (
          <span className="px-4 text-xs text-ln-danger">
            No se pudo dibujar el QR. Copiá el enlace de retiro.
          </span>
        ) : (
          <span className="text-xs text-ln-faint">Generando QR…</span>
        )}
        {expired ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ln-bg-deep/90 px-6 text-sm font-semibold text-ln-danger">
            Este retiro venció
          </div>
        ) : null}
      </div>

      <div className="mt-3 text-sm text-ln-soft" aria-live="polite">
        {expired ? (
          <span className="text-ln-danger">La ventana de retiro terminó.</span>
        ) : (
          <span>
            Disponible durante <span className="font-mono text-ln-corona">{countdownLabel(remaining)}</span>
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <a
          href={`lightning:${lnurl}`}
          className={`btn btn-corona w-full ${expired ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={expired}
        >
          Abrir en mi wallet
        </a>
        <Button type="button" variant="ghost" onClick={() => void copyLnurl()} disabled={expired}>
          {copied ? "Copiado ✓" : "Copiar retiro"}
        </Button>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ln-faint">
        Al escanear, tu wallet crea una factura por el monto exacto y Luna Negra la paga.
        El código sirve una sola vez.
      </p>
    </section>
  );
}

/** Mantiene la pantalla de callback actualizada mientras Luna paga el invoice. */
export function WithdrawStatusRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
