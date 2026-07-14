"use client";

import {
  BAL_DEFAULT_SESSION_TTL_MS,
  WebStorageBalAuthorizationStore,
  createBalAuthorization,
  matchesBalAuthorization,
  type BalAuthorization,
  type BalAuthorizationStore,
  type BalConsentRequest,
  type BalIdentitySource,
  type BalGameRegistry,
  type BalLauncher,
  type BalTransportEnvelope,
} from "nostr-game-protocol/bal";
import {
  registerBalSignerGame,
  reportBalDisconnecting,
  unregisterBalSignerGame,
} from "@/lib/bal-signer-status";

/**
 * Manifiesto confiable del launcher. Debe coincidir exactamente con PERMISSIONS
 * en `ajedrez/web/src/nostr/bal-login.ts`: el juego nunca puede ampliar por URL
 * los permisos que Luna ofrece antes de abrirlo.
 */
const BAL_GAME_MANIFESTS: Record<string, readonly string[]> = {
  ajedrez: [
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
  ],
};
const BAL_GAMES = new Set(Object.keys(BAL_GAME_MANIFESTS));
export const BAL_AUTHORIZATIONS_CHANGED = "luna-negra:bal-authorizations-changed";
const BAL_CONSENT_REQUIRED_MESSAGE = "luna-negra:bal-consent-required";
export const BAL_FOCUS_REQUEST_MESSAGE = "luna-negra:bal-focus-request";
const BAL_GAME_BINDING_PREFIX = "luna-negra:bal-game-binding:";
const BAL_SESSION_AUTHORIZATIONS_KEY = "luna-negra:bal-session-authorizations.v1";
const BAL_PRELAUNCH_DENIAL_PREFIX = "luna-negra:bal-prelaunch-denial:";
const BAL_PRELAUNCH_DENIAL_TTL_MS = 2 * 60_000;

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

/** Arma el consentimiento anticipado sólo para juegos con manifiesto local. */
export function createBalPreauthorizationRequest(
  input: BalPreauthorizationInput,
): BalConsentRequest | null {
  const permissions = BAL_GAME_MANIFESTS[input.gameId];
  if (!permissions) return null;
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
    permissions: [...permissions],
  };
}

/** Indica si el pre-permiso ya existe (por esta pestaña o recordado). */
export function hasBalAuthorization(request: BalConsentRequest): boolean {
  const now = Date.now();
  return [...sessionAuthorizationStore().list(), ...persistentAuthorizationStore().list()]
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
  if (!BAL_GAMES.has(gameId)) return null;
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
): void {
  if (!BAL_GAMES.has(gameId)) return;
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
  removeBalSessionAuthorizationsForGame(game.gameId);
  unregisterBalSignerGame(game.gameId, game.gameName);
  // BAL está habilitado para un único juego. Al cerrarlo también cerramos su
  // remoto efímero para que el estado de la navbar describa la conexión real.
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
    const records = [...this.session.list(), ...this.persistent.list()]
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

function removeBalSessionAuthorizationsForGame(gameId: string): void {
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
  return persistentAuthorizationStore().list();
}
