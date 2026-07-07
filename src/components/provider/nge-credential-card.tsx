"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Tarjeta de la credencial NGE (Nostr Game Escrow) de UN juego: la "NWC del
// escrow". Un solo string (`NGE_CONNECTION`) reemplaza API key + oráculo propio +
// fetch a ngp-config para el flujo de apuestas por eventos. Self-contenida
// (fetch/estado propios) siguiendo el patrón de ZapLeaderboard/IntegrationMatrix.
// Ver docs/nge/ y src/app/api/provider/nge/credential/route.ts.

type NgeCredential = {
  uri: string;
  escrowPubkey: string;
  servicePubkey: string;
  gameCoord: string;
  relays: string[];
  envVar: string;
};

function short(hex: string, n = 8): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

export function NgeCredentialCard({ gameId }: { gameId: string }) {
  const [cred, setCred] = useState<NgeCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!gameId) return;
    setError(null);
    const r = await fetch(
      `/api/provider/nge/credential?gameId=${encodeURIComponent(gameId)}`,
    );
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setCred(d);
    } else if (d?.error?.code === "NO_CREDENTIAL") {
      setCred(null); // todavía no se emitió: no es un error, mostramos el botón
    } else {
      setCred(null);
      setError(d?.error?.message ?? "No se pudo consultar la credencial NGE");
    }
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function issue(rotate: boolean) {
    if (
      rotate &&
      !confirm(
        "Rotar la credencial invalida la anterior: el game server que la tenga pegada en NGE_CONNECTION deja de poder firmar contratos/resultados hasta que actualices la variable. ¿Continuar?",
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setMsg(null);
    const r = await fetch("/api/provider/nge/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, rotate }),
    });
    const d = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) return setError(d?.error?.message ?? "No se pudo emitir la credencial NGE");
    setCred(d);
    setMsg(rotate ? "Credencial rotada." : "Credencial emitida.");
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setMsg(label);
  }

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Credencial NGE</h2>
        <span
          className="inline-flex items-center rounded-full bg-ln-luna/15 px-2 py-0.5 text-[10px] font-semibold text-ln-luna"
          title="Nostr Game Escrow: apuestas por eventos (kinds 1339/1341/31340) sobre el mismo motor de escrow."
        >
          NGE
        </span>
      </div>
      <p className="mb-3 mt-1 text-xs text-faint">
        Un solo string para el game server de este juego: reemplaza clave propia +
        oráculo + límites por config. Pegalo en <code>NGE_CONNECTION</code> y tenés
        contrato, depósito, estado y resultado por eventos Nostr —{" "}
        <strong>sin API key ni backend server-to-server</strong>.
      </p>

      {error ? <p className="mb-3 text-xs text-[var(--lose)]">{error}</p> : null}
      {msg ? <p className="mb-3 text-xs text-ln-aurora-bright">{msg}</p> : null}

      {cred ? (
        <div className="space-y-3">
          <div className="rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-3">
            <p className="text-xs text-muted">
              En Vercel usá <code>NGE_CONNECTION</code> como nombre. Pegá abajo solo
              este valor, sin <code>NGE_CONNECTION=</code> adelante:
            </p>
            <code className="mt-1 block break-all rounded-ln-sm bg-black/20 px-2 py-1 font-mono text-xs text-ink">
              {cred.uri}
            </code>
            <button
              type="button"
              onClick={() => copy(cred.uri, "Valor de NGE_CONNECTION copiado.")}
              className="mt-2 text-xs text-blue hover:underline"
            >
              Copiar solo el valor
            </button>
            <p className="mt-2 text-[11px] text-faint">
              En un <code>.env</code> local podes escribir <code>NGE_CONNECTION=</code>
              antes del valor.
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-1.5 text-[11px] text-faint sm:grid-cols-2">
            <div>
              <dt className="text-ln-faint">Escrow</dt>
              <dd className="font-mono text-ink">{short(cred.escrowPubkey)}</dd>
            </div>
            <div>
              <dt className="text-ln-faint">Oráculo (servicio)</dt>
              <dd className="font-mono text-ink">{short(cred.servicePubkey)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ln-faint">Coordenada</dt>
              <dd className="truncate font-mono text-ink">{cred.gameCoord}</dd>
            </div>
            <div>
              <dt className="text-ln-faint">Relays</dt>
              <dd className="text-ink">{cred.relays.length}</dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => issue(true)}
            disabled={loading}
          >
            Rotar credencial
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => issue(false)}
          disabled={loading || !gameId}
        >
          {loading ? "Emitiendo…" : "Generar credencial NGE"}
        </Button>
      )}
    </div>
  );
}
