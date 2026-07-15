"use client";

import {
  BAL_DEFAULT_SESSION_TTL_MS,
  WebStorageBalAuthorizationStore,
  balAuthorizationId,
  createBalAuthorization,
  matchesBalAuthorization,
  type BalAuthorization,
  type BalAuthorizationStore,
  type BalConsentRequest,
  type BalIdentitySource,
  type BalGameRegistry,
  type BalLauncherPersistedSession,
  type BalLauncherSessionStore,
  type BalLauncher,
  type BalTransportEnvelope,
} from "nostr-game-protocol/bal";
import {
  disableBalSignerGame,
  hasActiveBalSignerSession,
  registerBalSignerGame,
  reportBalDisconnecting,
  unregisterBalSignerGame,
} from "@/lib/bal-signer-status";

/** Manifiesto BAL estándar que Luna muestra antes de abrir un juego declarado.
 * El handshake real debe pedir exactamente esta lista para reutilizar el permiso;
 * cualquier diferencia vuelve a abrir el consentimiento con la lista real. */
const BAL_STANDARD_PERMISSIONS = [
  "get_public_key",
  "sign_event:1",
  "sign_event:13",
  "sign_event:22242",
  "sign_event:30315",
  "sign_event:31339",
  "sign_event:9734",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt",
] as const;
export const BAL_AUTHORIZATIONS_CHANGED = "luna-negra:bal-authorizations-changed";
const BAL_CONSENT_REQUIRED_MESSAGE = "luna-negra:bal-consent-required";
export const BAL_FOCUS_REQUEST_MESSAGE = "luna-negra:bal-focus-request";
const BAL_GAME_BINDING_PREFIX = "luna-negra:bal-game-binding:";
const BAL_SESSION_AUTHORIZATIONS_KEY = "luna-negra:bal-session-authorizations.v1";
const BAL_PRELAUNCH_DENIAL_PREFIX = "luna-negra:bal-prelaunch-denial:";
const BAL_PRELAUNCH_DENIAL_TTL_MS = 2 * 60_000;
const BAL_RESTORABLE_SESSIONS_KEY = "luna-negra:bal-restorable-sessions.v1";
const BAL_RELOAD_MARKER_KEY = "luna-negra:bal-reload-pending.v1";
const BAL_RELOAD_MARKER_TTL_MS = 2 * 60_000;

type RegisteredGame = { gameId: string; gameName: string; origin: string; peer: Window };
type PersistedGameBinding = Omit<RegisteredGame, "peer">;
const games = new Map<Window, RegisteredGame>();
let launcher: BalLauncher<Window> | null = null;

export type BalPreauthorizationInput = {
  gameId: string;
  gameName: string;
  gameUrl: string;
  identityId: string;
  pubkey: string;
  identitySource: BalIdentitySource;
  balCompatible: boolean;
};

function bindingKey(gameId: string): string {
  return `${BAL_GAME_BINDING_PREFIX}${gameId}`;
}

function prelaunchDenialKey(request: BalConsentRequest): string {
  // La negativa es para todo BAL de este lanzamiento, aunque el juego intente
  // pedir una lista distinta a la declarada en el manifiesto.
  const parts = [request.gameId, request.origin, request.identityId, request.pubkey];
  return `${BAL_PRELAUNCH_DENIAL_PREFIX}${parts.map(encodeURIComponent).join("|")}`;
}

/** Arma el consentimiento anticipado sólo si el proveedor declaró soporte BAL. */
export function createBalPreauthorizationRequest(
  input: BalPreauthorizationInput,
): BalConsentRequest | null {
  if (!input.balCompatible) return null;
  let origin: string;
  try {
    origin = new URL(input.gameUrl, window.location.origin).origin;
  } catch {
    return null;
  }
  return {
    gameId: input.gameId,
    gameName: input.gameName,
    origin,
    identityId: input.identityId,
    pubkey: input.pubkey,
    identitySource: input.identitySource,
    permissions: [...BAL_STANDARD_PERMISSIONS],
  };
}

/** Indica si el pre-permiso ya existe (por esta pestaña o recordado). */
export function hasBalAuthorization(request: BalConsentRequest): boolean {
  const now = Date.now();
  return [
    ...listCompatibleAuthorizations(sessionAuthorizationStore()),
    ...listCompatibleAuthorizations(persistentAuthorizationStore()),
  ]
    .some((record) => matchesBalAuthorization(record, request, now));
}

/** Concede antes de abrir el juego; no crea todavía ninguna sesión NIP-46. */
export function grantBalPreauthorization(
  request: BalConsentRequest,
  remember: boolean,
): void {
  if (remember) {
    createLunaBalAuthorizationStore().save(createBalAuthorization(request));
    return;
  }
  rememberBalAuthorizationForSession(request);
}

/** Evita que una negativa previa vuelva a abrir el consentimiento tras lanzar. */
export function suppressNextBalConsent(request: BalConsentRequest): void {
  try {
    sessionStorage.setItem(
      prelaunchDenialKey(request),
      String(Date.now() + BAL_PRELAUNCH_DENIAL_TTL_MS),
    );
  } catch {
    /* sin sessionStorage, el flujo BAL normal seguirá siendo el fallback */
  }
}

export function clearSuppressedBalConsent(request: BalConsentRequest): void {
  try { sessionStorage.removeItem(prelaunchDenialKey(request)); }
  catch { /* noop */ }
}

/** Consume una sola vez la negativa anticipada del mismo juego/origen/usuario. */
export function consumeSuppressedBalConsent(request: BalConsentRequest): boolean {
  try {
    const key = prelaunchDenialKey(request);
    const expiresAt = Number(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}

function persistGameBinding(binding: PersistedGameBinding): void {
  try {
    sessionStorage.setItem(bindingKey(binding.gameId), JSON.stringify(binding));
  } catch {
    /* sin sessionStorage: el registro conserva su vida normal en memoria */
  }
}

function removeGameBinding(gameId: string): void {
  try { sessionStorage.removeItem(bindingKey(gameId)); }
  catch { /* noop */ }
}

function restoreGameBinding(gameId: string): PersistedGameBinding | null {
  try {
    const raw = sessionStorage.getItem(bindingKey(gameId));
    if (!raw) return null;
    const binding = JSON.parse(raw) as Partial<PersistedGameBinding>;
    if (
      binding.gameId !== gameId
      || typeof binding.gameName !== "string"
      || typeof binding.origin !== "string"
      || new URL(binding.origin).origin !== binding.origin
    ) return null;
    return binding as PersistedGameBinding;
  } catch {
    return null;
  }
}

function resolveRegisteredGame(
  peer: Window,
  origin: string,
  gameId: string,
): RegisteredGame | null {
  let game = games.get(peer);
  // Una recarga de Luna destruye el Map y las sesiones NIP-46 efímeras, pero
  // sessionStorage y la pestaña hija sobreviven. Recuperamos solamente el
  // binding que Luna registró al abrir el juego y exigimos el mismo origen
  // exacto antes de asociar el nuevo MessageEvent.source.
  if (!game) {
    const binding = restoreGameBinding(gameId);
    if (!binding || binding.origin !== origin) return null;
    game = { ...binding, peer };
    games.set(peer, game);
  }
  return game.gameId === gameId && game.origin === origin ? game : null;
}

export const lunaBalGameRegistry: BalGameRegistry<Window> = {
  resolve(envelope: BalTransportEnvelope<Window>, gameId: string) {
    return resolveRegisteredGame(envelope.peer, envelope.origin, gameId);
  },
};

/** Registra sólo juegos BAL habilitados y fija ventana + origen exactos. */
export function registerBalGameWindow(
  gameId: string,
  gameName: string,
  peer: Window,
  gameUrl: string,
  balCompatible: boolean,
): void {
  if (!balCompatible) return;
  const origin = new URL(gameUrl, window.location.origin).origin;
  const binding = { gameId, gameName, origin };
  persistGameBinding(binding);
  games.set(peer, { ...binding, peer });
  registerBalSignerGame(gameId, gameName);
}

export function unregisterBalGameWindow(peer: Window): void {
  const game = games.get(peer);
  games.delete(peer);
  if (!game) return;
  removeGameBinding(game.gameId);
  // Ajedrez entrega la sesión al SharedWorker de su propio origen. La ventana
  // registrada puede cerrarse mientras otras pestañas siguen usando ese remoto
  // NIP-46; el worker o la expiración cierran la conexión real más adelante.
  const workerOwnsSession = hasActiveBalSignerSession(game.gameId);
  if (!workerOwnsSession) clearBalSessionAuthorizationsForGame(game.gameId);
  unregisterBalSignerGame(game.gameId, game.gameName, workerOwnsSession);
  if (!workerOwnsSession) void launcher?.logoutAll("launcher_logout");
}

function readRestorableSessions(): BalLauncherPersistedSession[] {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(BAL_RESTORABLE_SESSIONS_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed) ? parsed as BalLauncherPersistedSession[] : [];
  } catch {
    return [];
  }
}

function writeRestorableSessions(records: BalLauncherPersistedSession[]): void {
  try {
    if (records.length > 0) {
      sessionStorage.setItem(BAL_RESTORABLE_SESSIONS_KEY, JSON.stringify(records));
    } else {
      sessionStorage.removeItem(BAL_RESTORABLE_SESSIONS_KEY);
    }
  } catch {
    /* sin sessionStorage la sesión actual sigue funcionando, sin restauración */
  }
}

/** Marca un unload real para que la siguiente carga pueda reanudar el remoto NIP-46. */
export function prepareBalLauncherReload(): boolean {
  if (readRestorableSessions().length === 0) return false;
  try {
    sessionStorage.setItem(
      BAL_RELOAD_MARKER_KEY,
      String(Date.now() + BAL_RELOAD_MARKER_TTL_MS),
    );
    return true;
  } catch {
    return false;
  }
}

function consumeBalReloadMarker(): boolean {
  try {
    const expiresAt = Number(sessionStorage.getItem(BAL_RELOAD_MARKER_KEY));
    sessionStorage.removeItem(BAL_RELOAD_MARKER_KEY);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}

class LunaBalSessionStore implements BalLauncherSessionStore {
  list(): BalLauncherPersistedSession[] {
    // La marca se escribe en `pagehide`: una pestaña duplicada puede copiar
    // sessionStorage, pero no obtiene permiso para levantar el mismo remoto.
    if (!consumeBalReloadMarker()) {
      writeRestorableSessions([]);
      return [];
    }
    const records = readRestorableSessions().filter((record) => {
      if (
        typeof record?.requestId !== "string"
        || typeof record.gameId !== "string"
        || typeof record.origin !== "string"
      ) return false;
      const binding = restoreGameBinding(record.gameId);
      return Boolean(binding && binding.origin === record.origin);
    });
    writeRestorableSessions(records);
    return records;
  }

  save(session: BalLauncherPersistedSession): void {
    const records = readRestorableSessions()
      .filter((record) => record.requestId !== session.requestId);
    records.push(session);
    writeRestorableSessions(records);
  }

  remove(requestId: string): void {
    writeRestorableSessions(
      readRestorableSessions().filter((record) => record.requestId !== requestId),
    );
  }
}

export function createLunaBalSessionStore(): BalLauncherSessionStore {
  return new LunaBalSessionStore();
}

/** Desvincula BAL porque el jugador eligió iniciar el juego sin ese servicio. */
export function disableBalGameWindow(peer: Window): void {
  const game = games.get(peer);
  games.delete(peer);
  if (!game) return;
  removeGameBinding(game.gameId);
  clearBalSessionAuthorizationsForGame(game.gameId);
  disableBalSignerGame(game.gameId);
  void launcher?.logoutAll("launcher_logout");
}

/**
 * Le avisa al juego que Luna Negra abrió el consentimiento en su propia pestaña.
 * No forma parte del wire BAL ni incluye permisos/identidad: es sólo una señal de
 * UX para que la ventana enfocada pueda indicarle al jugador dónde continuar.
 */
export function notifyBalConsentRequired(gameId: string, origin: string): void {
  for (const game of games.values()) {
    if (game.gameId !== gameId || game.origin !== origin) continue;
    try {
      game.peer.postMessage(
        { type: BAL_CONSENT_REQUIRED_MESSAGE, gameId },
        game.origin,
      );
    } catch {
      /* ventana cerrada o navegada: el timeout normal de BAL resuelve el flujo */
    }
  }
}

/** Valida una señal auxiliar contra la misma ventana y origen registrados por BAL. */
export function matchesRegisteredBalGameWindow(
  peer: MessageEventSource | null,
  origin: string,
  gameId: string,
): boolean {
  if (!peer) return false;
  return resolveRegisteredGame(peer as Window, origin, gameId) !== null;
}

class NotifyingAuthorizationStore implements BalAuthorizationStore {
  private readonly persistent = persistentAuthorizationStore();
  private readonly session = sessionAuthorizationStore();

  list(): BalAuthorization[] {
    const now = Date.now();
    const records = [
      ...listCompatibleAuthorizations(this.session),
      ...listCompatibleAuthorizations(this.persistent),
    ]
      .filter((record) => record.expiresAt > now);
    return [...new Map(records.map((record) => [record.id, record])).values()];
  }

  save(authorization: BalAuthorization): void {
    this.persistent.save(authorization);
    this.session.remove(authorization.id);
    window.dispatchEvent(new Event(BAL_AUTHORIZATIONS_CHANGED));
  }

  remove(id: string): void {
    this.persistent.remove(id);
    this.session.remove(id);
    window.dispatchEvent(new Event(BAL_AUTHORIZATIONS_CHANGED));
  }
}

function persistentAuthorizationStore(): WebStorageBalAuthorizationStore {
  return new WebStorageBalAuthorizationStore(localStorage);
}

function sessionAuthorizationStore(): WebStorageBalAuthorizationStore {
  return new WebStorageBalAuthorizationStore(sessionStorage, BAL_SESSION_AUTHORIZATIONS_KEY);
}

/** Descarta grants de versiones previas cuyo ID no incluía el tipo de firmante. */
function listCompatibleAuthorizations(
  store: WebStorageBalAuthorizationStore,
): BalAuthorization[] {
  const compatible: BalAuthorization[] = [];
  for (const record of store.list()) {
    if (record.id === balAuthorizationId(record)) compatible.push(record);
    else store.remove(record.id);
  }
  return compatible;
}

export function clearBalSessionAuthorizationsForGame(gameId: string): void {
  try {
    const store = sessionAuthorizationStore();
    for (const authorization of store.list()) {
      if (authorization.gameId === gameId) store.remove(authorization.id);
    }
  } catch {
    /* sessionStorage bloqueado: el consentimiento no se pudo persistir */
  }
}

function clearBalSessionAuthorizations(): void {
  try { sessionStorage.removeItem(BAL_SESSION_AUTHORIZATIONS_KEY); }
  catch { /* noop */ }
}

/** Mantiene "Permitir esta vez" durante la vida de la pestaña de Luna. */
export function rememberBalAuthorizationForSession(request: BalConsentRequest): void {
  try {
    sessionAuthorizationStore().save(createBalAuthorization(
      request,
      Date.now(),
      BAL_DEFAULT_SESSION_TTL_MS,
    ));
  } catch {
    /* sin sessionStorage, "esta vez" conserva la semántica de una conexión */
  }
}

export function createLunaBalAuthorizationStore(): BalAuthorizationStore {
  return new NotifyingAuthorizationStore();
}

export function setActiveBalLauncher(value: BalLauncher<Window> | null): void {
  launcher = value;
}

export async function logoutBalLauncherSessions(): Promise<void> {
  reportBalDisconnecting();
  clearBalSessionAuthorizations();
  await launcher?.logoutAll("launcher_logout");
}

export async function revokeBalAuthorization(id: string): Promise<void> {
  if (launcher) await launcher.revokeAuthorization(id);
  else await createLunaBalAuthorizationStore().remove(id);
  window.dispatchEvent(new Event(BAL_AUTHORIZATIONS_CHANGED));
}

export function listBalAuthorizations(): BalAuthorization[] {
  if (typeof window === "undefined") return [];
  return listCompatibleAuthorizations(persistentAuthorizationStore());
}
