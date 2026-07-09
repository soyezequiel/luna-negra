"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Tarjeta del ORÁCULO DE ATESTACIONES (NGP kind:31338) de UN juego: la pubkey
// con la que el game server firma "en la sala X ganó Y". Se declara pegando la
// pubkey (npub o hex) directamente: el único que puede declarar es el dueño
// autenticado del juego, y una clave equivocada solo rompe SU tier verificado.
// El artículo 30023 del juego publica la delegación como tag ["oracle", pk];
// tras declarar/quitar hay que re-firmar el artículo (needsSignature).
// Self-contenida (fetch/estado propios), patrón NgeCredentialCard. Ver
// src/app/api/provider/games/[id]/attestation-oracle/route.ts.

type OracleState = { oraclePubkey: string | null };

function short(hex: string, n = 8): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

export function AttestationOracleCard({ gameId }: { gameId: string }) {
  const [state, setState] = useState<OracleState | null>(null);
  const [pubkeyInput, setPubkeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsSignature, setNeedsSignature] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!gameId) return;
    setError(null);
    const r = await fetch(`/api/provider/games/${encodeURIComponent(gameId)}/attestation-oracle`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setState(d);
    else {
      setState(null);
      setError(d?.error ?? "No se pudo consultar el oráculo de atestaciones");
    }
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function declare() {
    setLoading(true);
    setError(null);
    setMsg(null);
    const r = await fetch(
      `/api/provider/games/${encodeURIComponent(gameId)}/attestation-oracle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey: pubkeyInput }),
      },
    );
    const d = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(d?.error ?? "No se pudo declarar el oráculo");
    setPubkeyInput("");
    setNeedsSignature(Boolean(d?.needsSignature));
    setMsg("Oráculo declarado.");
    await load();
  }

  async function remove() {
    if (
      !confirm(
        "Quitar el oráculo apaga el tier verificado del juego: las atestaciones que firme el game server dejan de ser verificables. ¿Continuar?",
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setMsg(null);
    const r = await fetch(
      `/api/provider/games/${encodeURIComponent(gameId)}/attestation-oracle`,
      { method: "DELETE" },
    );
    const d = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(d?.error ?? "No se pudo quitar el oráculo");
    setNeedsSignature(Boolean(d?.needsSignature));
    setMsg("Oráculo quitado.");
    await load();
  }

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Oráculo de atestaciones</h2>
        <span
          className="inline-flex items-center rounded-full bg-ln-luna/15 px-2 py-0.5 text-[10px] font-semibold text-ln-luna"
          title="NGP kind:31338: tu game server certifica resultados que presenció (el ganador de un versus). El artículo del juego publica la delegación como tag oracle."
        >
          NGP 31338
        </span>
      </div>
      <p className="mb-3 mt-1 text-xs text-faint">
        La pubkey con la que <strong>tu game server</strong> firma resultados
        verificados (&quot;en la sala X ganó Y&quot;) — la derivada de{" "}
        <code>NGP_ATTESTATION_ORACLE_NSEC</code>. Pegala como npub o hex:{" "}
        <strong>acá va la clave pública, nunca la nsec</strong>.
      </p>

      {error ? <p className="mb-3 text-xs text-[var(--lose)]">{error}</p> : null}
      {msg ? <p className="mb-3 text-xs text-ln-aurora-bright">{msg}</p> : null}
      {needsSignature ? (
        <p className="mb-3 text-xs text-ln-luna">
          La delegación viaja EN el artículo del juego: firmá y difundí el artículo
          (botón &quot;Firmar y difundir&quot;) para que llegue a relays.
        </p>
      ) : null}

      {state?.oraclePubkey ? (
        <div className="space-y-3">
          <dl className="text-[11px] text-faint">
            <dt className="text-ln-faint">Oráculo declarado</dt>
            <dd className="font-mono text-ink">{short(state.oraclePubkey, 12)}</dd>
          </dl>
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={loading}>
            Quitar oráculo
          </Button>
        </div>
      ) : state ? (
        <div className="space-y-3">
          <input
            type="text"
            value={pubkeyInput}
            onChange={(e) => setPubkeyInput(e.target.value)}
            placeholder="npub1… o hex de 64"
            className="w-full rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-2 font-mono text-xs text-ink"
          />
          <p className="text-[11px] text-faint">
            En el repo del juego: <code>node scripts/attestation-oracle-pubkey.mjs</code>{" "}
            imprime la pubkey de tu <code>NGP_ATTESTATION_ORACLE_NSEC</code>.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={declare}
            disabled={loading || !pubkeyInput.trim()}
          >
            {loading ? "Declarando…" : "Declarar oráculo"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
