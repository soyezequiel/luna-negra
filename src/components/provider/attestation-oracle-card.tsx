"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Tarjeta del ORÁCULO DE ATESTACIONES (NGP kind:31338) de UN juego: la pubkey
// con la que el game server firma "en la sala X ganó Y". Se declara con PRUEBA
// DE POSESIÓN: el reto se firma DONDE VIVE la clave (el server del juego; ver
// scripts/attestation-oracle-proof.mjs en el repo del juego) y acá solo se pega
// el evento firmado — la clave nunca toca el navegador. El artículo 30023 del
// juego publica la delegación como tag ["oracle", pk]; tras declarar/quitar hay
// que re-firmar el artículo (needsSignature). Self-contenida (fetch/estado
// propios), patrón NgeCredentialCard. Ver
// src/app/api/provider/games/[id]/attestation-oracle/route.ts.

type OracleState = { oraclePubkey: string | null; challenge: string };

function short(hex: string, n = 8): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

export function AttestationOracleCard({ gameId }: { gameId: string }) {
  const [state, setState] = useState<OracleState | null>(null);
  const [proofJson, setProofJson] = useState("");
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
    let proof: unknown;
    try {
      proof = JSON.parse(proofJson);
    } catch {
      setError("Eso no es JSON: pegá el evento COMPLETO que imprime el script.");
      return;
    }
    setLoading(true);
    setError(null);
    setMsg(null);
    const r = await fetch(
      `/api/provider/games/${encodeURIComponent(gameId)}/attestation-oracle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof }),
      },
    );
    const d = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(d?.error ?? "No se pudo declarar el oráculo");
    setProofJson("");
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

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setMsg(label);
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
        verificados (&quot;en la sala X ganó Y&quot;). Se declara con prueba de
        posesión: la clave firma un reto en tu server y acá pegás la firma —{" "}
        <strong>la clave nunca sale de tu máquina</strong>.
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
          <div className="rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-3">
            <p className="text-xs text-muted">
              1) En el repo de tu juego, firmá este reto con la clave del oráculo
              (la misma de <code>NGP_ATTESTATION_ORACLE_NSEC</code>):
            </p>
            <code className="mt-1 block break-all rounded-ln-sm bg-black/20 px-2 py-1 font-mono text-xs text-ink">
              node scripts/attestation-oracle-proof.mjs &quot;{state.challenge}&quot;
            </code>
            <button
              type="button"
              onClick={() =>
                copy(
                  `node scripts/attestation-oracle-proof.mjs "${state.challenge}"`,
                  "Comando copiado.",
                )
              }
              className="mt-2 text-xs text-blue hover:underline"
            >
              Copiar comando
            </button>
            <p className="mt-2 text-[11px] text-faint">
              Sin el script: firmá un evento Nostr cuyo <code>content</code> sea
              EXACTAMENTE el reto, con <code>created_at</code> actual (vence a los 5
              minutos).
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">2) Pegá el JSON del evento firmado:</p>
            <textarea
              value={proofJson}
              onChange={(e) => setProofJson(e.target.value)}
              rows={3}
              placeholder='{"id":"…","pubkey":"…","sig":"…",…}'
              className="w-full rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-2 font-mono text-xs text-ink"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={declare}
            disabled={loading || !proofJson.trim()}
          >
            {loading ? "Declarando…" : "Declarar oráculo"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
