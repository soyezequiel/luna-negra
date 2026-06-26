/**
 * Buzón local de retos 1v1 recibidos (interfaz 2.0, NIP-17). Espejo del patrón de
 * invitaciones pendientes de `invite.ts`: el `NotificationsProvider` sondea los
 * retos entrantes (gift-wraps) y los guarda acá; la barra de amigos los ancla
 * arriba con Aceptar/Rechazar. localStorage + evento de cambio (client-only).
 *
 * Ver src/lib/game-challenge.ts (protocolo) y docs/perfil-juego-nostr-salas-invitaciones.md.
 */

export type PendingChallenge = {
  fromPubkey: string; // hex de quien retó (verificado contra la firma)
  game: string; // coordenada 30023:<tienda>:<slug>
  slug: string; // derivado de la coordenada (para abrir el juego)
  message: string; // texto humano del reto
  url?: string; // deep link opcional
  wrapId: string; // id del gift-wrap (dedup)
  at: number; // recepción local
};

const KEY = "ln_pending_challenges";
const TTL_MS = 24 * 3_600_000; // 24h (los retos viven más que una sala)
const EVENT = "ln:pending-challenges-change";

function emitChange(): void {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* SSR / sin window: no-op */
  }
}

/** Slug del juego a partir de la coordenada `30023:<pubkey>:<slug>`. */
export function slugFromCoord(coord: string): string | null {
  const parts = coord.split(":");
  return parts.length >= 3 && parts[2] ? parts.slice(2).join(":") : null;
}

/** Retos pendientes vigentes (descarta los expirados). */
export function getPendingChallenges(): PendingChallenge[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PendingChallenge[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (c) => c && typeof c.at === "number" && Date.now() - c.at <= TTL_MS,
    );
  } catch {
    return [];
  }
}

function write(list: PendingChallenge[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin localStorage: no pasa nada */
  }
  emitChange();
}

/**
 * Registra un reto recibido. Dedup por `wrapId`; una vez rechazado/aceptado un
 * `wrapId`, no vuelve a aparecer aunque el relay lo re-sirva (cola de descartados).
 */
export function addPendingChallenge(c: PendingChallenge): boolean {
  if (isDismissed(c.wrapId)) return false;
  const list = getPendingChallenges();
  if (list.some((x) => x.wrapId === c.wrapId)) return false;
  list.push(c);
  write(list);
  return true;
}

/** Quita un reto del buzón y lo marca descartado (no reaparece). */
export function removePendingChallenge(wrapId: string): void {
  dismiss(wrapId);
  write(getPendingChallenges().filter((c) => c.wrapId !== wrapId));
}

export function onPendingChallengesChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

// --- Descartados (para no re-anclar lo que el usuario ya cerró/aceptó) ---

const DISMISSED_KEY = "ln_dismissed_challenges";

function dismissedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr.slice(-200) : []);
  } catch {
    return new Set();
  }
}

function isDismissed(wrapId: string): boolean {
  return dismissedSet().has(wrapId);
}

function dismiss(wrapId: string): void {
  try {
    const s = dismissedSet();
    s.add(wrapId);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* no-op */
  }
}
