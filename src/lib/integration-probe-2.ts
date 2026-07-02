import { SimplePool, type Event } from "nostr-tools";
import { RELAYS } from "./constants";

// Probador en vivo de la interfaz 2.0 (Nostr), análogo al health-check REST 1.0
// (integration-probe.ts) pero por juego: consulta los relays por la coordenada
// del juego (#a) y por su anuncio (#e, para zaps) y reporta cuántos eventos de
// cada tipo existen AHORA. Acá "hay integración" = hay evidencia en relays.
//
// Hace como mucho DOS queries a relays (una por #a de TODOS los juegos, otra por
// #e), así no escala con la cantidad de juegos. Read-only: no publica nada.

export type NostrProbeResult = {
  key: string; // CapabilityRow.key de integration-2.ts
  found: number; // eventos encontrados en relays
  latencyMs: number | null;
  detail: string;
  skipped: boolean; // no se puede probar (cifrado/login/diseño) o falta coordenada
};

export type GameNostrRef = {
  id: string;
  nostrCoord: string | null;
  nostrEventId: string | null;
};

// Filas 2.0 verificables consultando relays por la coordenada (#a), con el kind
// que las prueba. (zaps va aparte: se ancla al anuncio con #e.)
const COORD_PROBES: Array<{ key: string; kind: number; label: string }> = [
  { key: "marcador", kind: 31337, label: "puntajes kind:31337" },
  { key: "presencia", kind: 30315, label: "presencia NIP-38 (kind:30315)" },
  { key: "resenas", kind: 1, label: "reseñas/comentarios kind:1" },
  { key: "oraculo", kind: 31338, label: "atestaciones de oráculo kind:31338" },
];

// Filas 2.0 que NO se pueden probar en vivo, con el porqué (siempre se reportan
// como `skipped` para que la UI lo explique en vez de mostrar un falso fallo).
const UNPROBEABLE: Array<{ key: string; reason: string }> = [
  { key: "invitaciones", reason: "Las invitaciones 2.0 son DMs NIP-17 cifrados E2E: no observables desde el server." },
  { key: "identidad", reason: "El login NIP-07/46 no deja un evento por juego que consultar." },
  { key: "salas", reason: "Las salas con estado (NIP-29) no se anclan a la coordenada del juego." },
];

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

export async function probeGamesNostr(
  games: GameNostrRef[],
): Promise<Record<string, NostrProbeResult[]>> {
  const out: Record<string, NostrProbeResult[]> = {};
  for (const g of games) {
    // Las no-probeable están siempre presentes (explican por qué no se prueban).
    out[g.id] = UNPROBEABLE.map((u) => ({
      key: u.key,
      found: 0,
      latencyMs: null,
      detail: u.reason,
      skipped: true,
    }));
  }
  if (games.length === 0) return out;

  const coordToGame = new Map<string, string>();
  const eventToGame = new Map<string, string>();
  for (const g of games) {
    if (g.nostrCoord) coordToGame.set(g.nostrCoord, g.id);
    if (g.nostrEventId) eventToGame.set(g.nostrEventId, g.id);
  }

  // Conteos por (gameId, key).
  const counts = new Map<string, Map<string, number>>();
  const bump = (gameId: string, key: string) => {
    let m = counts.get(gameId);
    if (!m) counts.set(gameId, (m = new Map()));
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  const kindToKey = new Map(COORD_PROBES.map((p) => [p.kind, p.key]));

  const started = Date.now();
  let coordEvents: Event[] = [];
  let zapEvents: Event[] = [];
  await Promise.all([
    coordToGame.size > 0
      ? pool()
          .querySync(
            RELAYS,
            { kinds: COORD_PROBES.map((p) => p.kind), "#a": [...coordToGame.keys()] },
            { maxWait: 6000 },
          )
          .then((ev) => {
            coordEvents = ev;
          })
          .catch(() => {})
      : Promise.resolve(),
    eventToGame.size > 0
      ? pool()
          .querySync(RELAYS, { kinds: [9735], "#e": [...eventToGame.keys()] }, { maxWait: 6000 })
          .then((ev) => {
            zapEvents = ev;
          })
          .catch(() => {})
      : Promise.resolve(),
  ]);
  const latencyMs = Date.now() - started;

  for (const ev of coordEvents) {
    const key = kindToKey.get(ev.kind);
    if (!key) continue;
    const coord = ev.tags.find((t) => t[0] === "a")?.[1];
    const gameId = coord ? coordToGame.get(coord) : undefined;
    if (gameId) bump(gameId, key);
  }
  for (const ev of zapEvents) {
    const eid = ev.tags.find((t) => t[0] === "e")?.[1];
    const gameId = eid ? eventToGame.get(eid) : undefined;
    if (gameId) bump(gameId, "zaps");
  }

  for (const g of games) {
    const m = counts.get(g.id);
    const results = out[g.id];

    for (const p of COORD_PROBES) {
      if (!g.nostrCoord) {
        results.push({
          key: p.key,
          found: 0,
          latencyMs: null,
          detail: "El juego todavía no tiene coordenada Nostr (publicá su artículo).",
          skipped: true,
        });
        continue;
      }
      const found = m?.get(p.key) ?? 0;
      results.push({
        key: p.key,
        found,
        latencyMs,
        detail:
          found > 0
            ? `${found} evento(s) de ${p.label} en los relays.`
            : `Sin ${p.label} en los relays para la coordenada del juego.`,
        skipped: false,
      });
    }

    // Zaps (ancla #e = anuncio del juego).
    if (!g.nostrEventId) {
      results.push({
        key: "zaps",
        found: 0,
        latencyMs: null,
        detail: "El juego todavía no tiene anuncio Nostr (se publica al aprobar/editar).",
        skipped: true,
      });
    } else {
      const found = m?.get("zaps") ?? 0;
      results.push({
        key: "zaps",
        found,
        latencyMs,
        detail:
          found > 0
            ? `${found} recibo(s) de zap (kind:9735) al anuncio.`
            : "Sin recibos de zap (kind:9735) al anuncio en los relays.",
        skipped: false,
      });
    }
  }

  return out;
}
