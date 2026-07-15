"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// El reporte llega como JSON del server (src/lib/presence-report.ts). Tipamos solo
// lo que renderizamos acá; el objeto completo se descarga tal cual.
type Severity = "info" | "warn" | "alert";
type Diagnostic = { code: string; severity: Severity; message: string; detail?: unknown };
type Report = {
  serverClock: { iso: string; nowSec: number };
  game: { slug: string; title: string; status: string };
  coord: string;
  liveBadge: {
    getLiveNow: number;
    getPeakToday: number;
    computedFromRelaysNow: number;
    resolution: Array<{
      npub: string;
      counted: boolean;
      classification: string;
      ageSeconds: number;
      secondsUntilExpiry: number | null;
      hasExpiration: boolean;
    }>;
    perRelay: Array<{
      relay: string;
      ok: boolean;
      error: string | null;
      events: number;
      latestCreatedAt: number | null;
    }>;
  };
  friendsRail: {
    resolution: Array<{
      npub: string;
      showsAsPlaying: boolean;
      classification: string;
      ageSeconds: number;
      effectiveExpiryInSeconds: number;
    }>;
  };
  serverMemory: { liveNpubs: string[] };
  rawEvents: {
    coordAnchored: Array<{
      npub: string;
      classification: string;
      ageSeconds: number;
      hasExpiration: boolean;
      secondsUntilExpiry: number | null;
      withinLiveWindow: boolean;
      contentLength: number;
      servedByRelays: string[];
    }>;
  };
  db: {
    playerCountSamples: Array<{ count: number; source: string; sampledAt: string }>;
    integrationPings: Array<{ feature: string; count: number; lastSeenAt: string }>;
  };
};
type GameRow = { id: string; slug: string; title: string };

const SEV_COLOR: Record<Severity, string> = {
  alert: "var(--ln-danger)",
  warn: "var(--btc)",
  info: "var(--muted)",
};

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}
function ago(seconds: number): string {
  if (seconds < 0) return `en ${Math.abs(seconds)}s (futuro)`;
  if (seconds < 90) return `hace ${seconds}s`;
  return `hace ${Math.round(seconds / 60)}min`;
}

export default function PresenceDiagnosticsPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<GameRow[]>([]);
  const [gameId, setGameId] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadGames = useCallback(async () => {
    const r = await fetch("/api/admin/presence-report");
    if (r.status === 403) {
      setForbidden(true);
      setLoaded(true);
      return;
    }
    const d = await r.json().catch(() => ({ games: [] }));
    setForbidden(false);
    setGames(d.games ?? []);
    setLoaded(true);
  }, []);

  const generate = useCallback(async (gid: string) => {
    if (!gid) return;
    setBusy(true);
    setReport(null);
    try {
      const d = await fetch(
        `/api/admin/presence-report?gameId=${encodeURIComponent(gid)}`,
      )
        .then((res) => res.json())
        .catch(() => null);
      setReport(d && !d.error ? d : null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void loadGames();
  }, [user, loadGames]);

  function selectGame(id: string) {
    setGameId(id);
    void generate(id);
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Diagnóstico de presencia (admin)</h1>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>Iniciar sesión</Button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted">
        No estás autorizado para ver esta página.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Diagnóstico de presencia
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ln-muted">
            Junta todo lo necesario para entender por qué un juego cerrado se sigue
            detectando como abierto (o &ldquo;vuelve&rdquo; sin reabrirse): eventos NIP-38
            crudos por relay, la resolución del badge en vivo y del riel de amigos, el
            estado en memoria del server y banderas de diagnóstico.{" "}
            <strong className="text-ln-text">
              Cerrá el juego y generá el reporte enseguida para capturar el estado colgado.
            </strong>
          </p>
        </div>
        <Link href="/admin" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {!loaded ? (
        <p className="mt-6 text-sm text-ln-faint">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-6 text-sm text-ln-faint">
          No hay juegos publicados con coordenada Nostr (los únicos con presencia NGP).
        </p>
      ) : (
        <>
          {/* Selector de juego */}
          <div className="mt-6">
            <label className="ln-label">Juego</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {games.map((gm) => (
                <button
                  key={gm.id}
                  type="button"
                  onClick={() => selectGame(gm.id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors",
                    gameId === gm.id
                      ? "border-blue/50 bg-blue/15 text-blue"
                      : "border-ln-border text-ln-muted hover:text-ln-text",
                  )}
                >
                  {gm.title}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            {!gameId ? (
              <p className="text-sm text-ln-faint">Elegí un juego para generar el reporte.</p>
            ) : busy ? (
              <p className="text-sm text-ln-faint">Consultando relays y DB…</p>
            ) : !report ? (
              <p className="text-sm text-ln-faint">No se pudo generar el reporte.</p>
            ) : (
              <ReportView report={report} gameId={gameId} onRegenerate={() => generate(gameId)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ReportView({
  report,
  gameId,
  onRegenerate,
}: {
  report: Report;
  gameId: string;
  onRegenerate: () => void;
}) {
  const { liveBadge, friendsRail, rawEvents, db, serverMemory } = report;
  const diagnostics = (report as unknown as { diagnostics: Diagnostic[] }).diagnostics ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/admin/presence-report?gameId=${encodeURIComponent(gameId)}&download=1`}
          className="btn btn-luna"
          download
        >
          Descargar reporte JSON
        </a>
        <Button variant="ghost" onClick={onRegenerate}>
          Regenerar
        </Button>
        <span className="text-[11px] text-ln-faint">
          Generado {new Date(report.serverClock.iso).toLocaleString("es-AR")}
        </span>
      </div>

      {/* Banderas de diagnóstico */}
      <Section title="Diagnóstico">
        <ul className="flex flex-col gap-2">
          {diagnostics.map((d, i) => (
            <li
              key={i}
              className="rounded border border-line bg-black/10 p-2.5"
              style={{ borderLeft: `3px solid ${SEV_COLOR[d.severity]}` }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: SEV_COLOR[d.severity] }}
                >
                  {d.severity}
                </span>
                <span className="font-mono text-[10px] text-ln-faint">{d.code}</span>
              </div>
              <p className="mt-1 text-[13px] text-ln-text">{d.message}</p>
              {d.detail != null && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-tight text-ln-muted">
                  {JSON.stringify(d.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* Badge en vivo */}
      <Section title="Badge “jugando ahora”">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="getLiveNow()" value={liveBadge.getLiveNow} />
          <Metric label="desde relays ahora" value={liveBadge.computedFromRelaysNow} />
          <Metric label="en memoria" value={serverMemory.liveNpubs.length} />
          <Metric label="pico hoy" value={liveBadge.getPeakToday} />
        </div>
        {liveBadge.resolution.length > 0 && (
          <Table
            className="mt-3"
            head={["jugador", "¿cuenta?", "tipo", "edad", "vence en"]}
            rows={liveBadge.resolution.map((r) => [
              shortNpub(r.npub),
              r.counted ? "sí" : "no",
              r.classification,
              ago(r.ageSeconds),
              r.secondsUntilExpiry === null
                ? r.hasExpiration
                  ? "—"
                  : "sin NIP-40"
                : `${r.secondsUntilExpiry}s`,
            ])}
          />
        )}
      </Section>

      {/* Relays */}
      <Section title="Eventos por relay (coordenada del juego)">
        <Table
          head={["relay", "eventos", "último", "estado"]}
          rows={liveBadge.perRelay.map((r) => [
            r.relay.replace("wss://", ""),
            String(r.events),
            r.latestCreatedAt === null
              ? "—"
              : ago(report.serverClock.nowSec - r.latestCreatedAt),
            r.ok ? "ok" : `error: ${r.error ?? ""}`,
          ])}
        />
      </Section>

      {/* Eventos crudos */}
      <Section title={`Eventos NIP-38 crudos anclados a la coordenada (${rawEvents.coordAnchored.length})`}>
        {rawEvents.coordAnchored.length === 0 ? (
          <p className="text-[13px] text-ln-faint">Ningún relay tiene eventos anclados a esta coordenada.</p>
        ) : (
          <Table
            head={["jugador", "tipo", "edad", "NIP-40", "vence en", "ventana", "len", "relays"]}
            rows={rawEvents.coordAnchored.map((e) => [
              shortNpub(e.npub),
              e.classification,
              ago(e.ageSeconds),
              e.hasExpiration ? "sí" : "NO",
              e.secondsUntilExpiry === null ? "—" : `${e.secondsUntilExpiry}s`,
              e.withinLiveWindow ? "dentro" : "fuera",
              String(e.contentLength),
              String(e.servedByRelays.length),
            ])}
          />
        )}
      </Section>

      {/* Riel de amigos */}
      {friendsRail.resolution.length > 0 && (
        <Section title="Riel de amigos (slot d:general, fallback 1h)">
          <Table
            head={["jugador", "¿lo muestra?", "tipo", "edad", "vence en"]}
            rows={friendsRail.resolution.map((r) => [
              shortNpub(r.npub),
              r.showsAsPlaying ? "sí" : "no",
              r.classification,
              ago(r.ageSeconds),
              `${r.effectiveExpiryInSeconds}s`,
            ])}
          />
        </Section>
      )}

      {/* DB */}
      <Section title="Historial (PlayerCountSample, últimas muestras)">
        {db.playerCountSamples.length === 0 ? (
          <p className="text-[13px] text-ln-faint">Sin muestras.</p>
        ) : (
          <Table
            head={["cuándo", "count", "fuente"]}
            rows={db.playerCountSamples.map((s) => [
              new Date(s.sampledAt).toLocaleTimeString("es-AR"),
              String(s.count),
              s.source,
            ])}
          />
        )}
        {db.integrationPings.length > 0 && (
          <div className="mt-3">
            <p className="ln-label">Pings de integración</p>
            <Table
              className="mt-1.5"
              head={["feature", "count", "último"]}
              rows={db.integrationPings.map((p) => [
                p.feature,
                String(p.count),
                new Date(p.lastSeenAt).toLocaleString("es-AR"),
              ])}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-black/10 p-2.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-none text-ink">{value}</p>
    </div>
  );
}

function Table({
  head,
  rows,
  className,
}: {
  head: string[];
  rows: string[][];
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[480px] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-mono text-[10px] uppercase tracking-wider text-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line/50">
              {row.map((cell, j) => (
                <td key={j} className="py-1.5 pr-3 font-mono text-ln-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
