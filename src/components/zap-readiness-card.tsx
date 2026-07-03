"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ZapReadiness } from "@/lib/zap-readiness";

// Tarjeta de aptitud para recibir zaps. Vive en /profile/editar: le dice al usuario
// si el pago que recibiría al ganar una apuesta saldría como zap social NIP-57 y,
// si no, lo guía con pasos concretos. Deja además probar una dirección candidata
// antes de configurarla. Consume GET /api/me/zap-readiness.

async function fetchReadiness(address?: string): Promise<ZapReadiness> {
  const qs = address ? `?address=${encodeURIComponent(address)}` : "";
  const res = await fetch(`/api/me/zap-readiness${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "No se pudo verificar");
  return data as ZapReadiness;
}

export function ZapReadinessCard() {
  const [result, setResult] = useState<ZapReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchReadiness());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al verificar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ln-text">
          Aptitud para recibir zaps
        </h2>
        <Button variant="ghost" onClick={() => void check()} disabled={loading}>
          {loading ? "Verificando…" : "Volver a verificar"}
        </Button>
      </div>
      <p className="mt-1 text-sm text-ln-muted">
        Chequeamos si el premio que recibirías al ganar una apuesta puede salir como
        zap social (visible en Nostr) o caería a un cobro por QR sin recibo.
      </p>

      {error ? (
        <p className="mt-4 text-sm text-ln-danger">{error}</p>
      ) : loading && !result ? (
        <p className="mt-4 text-sm text-ln-muted">Verificando tu perfil…</p>
      ) : result ? (
        <Verdict result={result} />
      ) : null}

      <ProbeAddress />
    </section>
  );
}

function Verdict({ result }: { result: ZapReadiness }) {
  const ok = result.ready;
  return (
    <div
      className={`mt-4 rounded-ln-md border p-4 ${
        ok
          ? "border-ln-aurora/40 bg-ln-aurora/10"
          : "border-ln-corona/40 bg-ln-corona/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {ok ? "⚡" : "⚠"}
        </span>
        <span
          className={`text-[14px] font-semibold ${
            ok ? "text-ln-aurora" : "text-ln-corona-bright"
          }`}
        >
          {result.title}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-ln-soft">{result.reason}</p>

      {result.address ? (
        <p className="mt-2 text-[12.5px] text-ln-muted">
          Dirección evaluada:{" "}
          <span className="font-mono text-ln-text">{result.address}</span>
          {result.source === "profile" ? " (de tu perfil Nostr)" : null}
        </p>
      ) : null}

      {result.steps.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold text-ln-soft">Cómo solucionarlo:</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-ln-muted">
            {result.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

// Prueba una dirección candidata sin guardarla, para que el usuario confirme que un
// wallet nuevo sirve antes de configurarlo.
function ProbeAddress() {
  const [value, setValue] = useState("");
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ZapReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function probe(e: React.FormEvent) {
    e.preventDefault();
    const addr = value.trim();
    if (!addr) return;
    setProbing(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fetchReadiness(addr));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al probar");
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="mt-5 border-t border-ln-border pt-4">
      <h3 className="text-[13px] font-semibold text-ln-soft">Probar otra dirección</h3>
      <p className="mt-1 text-[12.5px] text-ln-muted">
        ¿Querés saber si un wallet nuevo soporta zaps? Probalo acá antes de configurarlo.
      </p>
      <form onSubmit={probe} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="usuario@dominio.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
            setError(null);
          }}
          className="w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 text-sm text-ln-text placeholder:text-ln-faint focus:outline-none focus:ring-2 focus:ring-ln-corona/40"
        />
        <Button variant="ghost" type="submit" disabled={probing || !value.trim()}>
          {probing ? "Probando…" : "Probar"}
        </Button>
      </form>

      {error ? <p className="mt-2 text-sm text-ln-danger">{error}</p> : null}
      {result ? (
        <p
          className={`mt-2 text-[13px] ${
            result.ready ? "text-ln-aurora" : "text-ln-corona-bright"
          }`}
        >
          {result.ready ? "⚡ Soporta zaps NIP-57 ✓" : `⚠ ${result.title} — ${result.reason}`}
        </p>
      ) : null}
    </div>
  );
}
