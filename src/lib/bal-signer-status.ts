"use client";

/** Estado visible del signer BAL que Luna Negra presta a los juegos. */
export type BalSignerPhase =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "awaiting_approval"
  | "connected"
  | "signing"
  | "encrypting"
  | "decrypting"
  | "signed"
  | "disconnecting"
  | "disconnected"
  | "rejected"
  | "error";

export type BalSignerStatus = {
  phase: BalSignerPhase;
  gameName: string | null;
  activeSessions: number;
  detail: string | null;
};

type ActiveSession = {
  requestId: string;
  gameId: string;
  gameName: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type PersistedSession = Omit<ActiveSession, "timer">;

const PERSISTED_SESSIONS_KEY = "luna-negra:bal-active-sessions";
const IDLE_STATUS: BalSignerStatus = {
  phase: "idle",
  gameName: null,
  activeSessions: 0,
  detail: null,
};

let status = IDLE_STATUS;
let transientTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const registeredGames = new Map<string, string>();
const pendingRequests = new Map<string, { gameId: string; gameName: string }>();
const activeSessions = new Map<string, ActiveSession>();
const previouslyConnectedGames = new Set<string>();
const intentionallyDeniedRequests = new Set<string>();

function emit(next: BalSignerStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function clearTransientTimer(): void {
  if (!transientTimer) return;
  clearTimeout(transientTimer);
  transientTimer = null;
}

function currentGameName(): string | null {
  return [...activeSessions.values()].at(-1)?.gameName
    ?? [...pendingRequests.values()].at(-1)?.gameName
    ?? status.gameName
    ?? [...registeredGames.values()].at(-1)
    ?? null;
}

function stableStatus(): BalSignerStatus {
  if (activeSessions.size > 0) {
    return {
      phase: "connected",
      gameName: currentGameName(),
      activeSessions: activeSessions.size,
      detail: activeSessions.size === 1
        ? "Sesión de firma activa"
        : `${activeSessions.size} sesiones de firma activas`,
    };
  }
  if (registeredGames.size > 0) {
    return {
      phase: "disconnected",
      gameName: currentGameName(),
      activeSessions: 0,
      detail: "El juego sigue abierto, sin una sesión de firma activa",
    };
  }
  return IDLE_STATUS;
}

function returnToStableAfter(delayMs: number): void {
  clearTransientTimer();
  transientTimer = setTimeout(() => {
    transientTimer = null;
    emit(stableStatus());
  }, delayMs);
}

function persistSessions(): void {
  if (typeof window === "undefined") return;
  try {
    const records = [...activeSessions.values()].map((session) => ({
      requestId: session.requestId,
      gameId: session.gameId,
      gameName: session.gameName,
      expiresAt: session.expiresAt,
    }));
    if (records.length > 0) sessionStorage.setItem(PERSISTED_SESSIONS_KEY, JSON.stringify(records));
    else sessionStorage.removeItem(PERSISTED_SESSIONS_KEY);
  } catch {
    /* sessionStorage puede estar bloqueado; el estado en memoria sigue funcionando. */
  }
}

function removeSession(requestId: string): ActiveSession | null {
  const session = activeSessions.get(requestId) ?? null;
  if (!session) return null;
  if (session.timer) clearTimeout(session.timer);
  activeSessions.delete(requestId);
  persistSessions();
  return session;
}

function expireSession(requestId: string): void {
  const session = removeSession(requestId);
  if (!session) return;
  emit({
    phase: "disconnected",
    gameName: session.gameName,
    activeSessions: activeSessions.size,
    detail: "La sesión de firma venció",
  });
  if (activeSessions.size > 0) returnToStableAfter(2200);
}

function addSession(
  requestId: string,
  gameId: string,
  gameName: string,
  expiresAt: number,
): void {
  removeSession(requestId);
  const remaining = Math.max(0, expiresAt - Date.now());
  const session: ActiveSession = {
    requestId,
    gameId,
    gameName,
    expiresAt,
    timer: setTimeout(() => expireSession(requestId), remaining),
  };
  activeSessions.set(requestId, session);
  previouslyConnectedGames.add(gameId);
  persistSessions();
}

export function subscribeBalSignerStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBalSignerStatusSnapshot(): BalSignerStatus {
  return status;
}

export function getBalSignerStatusServerSnapshot(): BalSignerStatus {
  return IDLE_STATUS;
}

export function hasActiveBalSignerSession(gameId: string): boolean {
  for (const session of activeSessions.values()) {
    if (session.gameId === gameId && session.expiresAt > Date.now()) return true;
  }
  return false;
}

/** Recupera únicamente metadatos no secretos para mostrar una reconexión tras recargar Luna. */
export function restoreBalSignerStatus(): void {
  if (typeof window === "undefined") return;
  let records: PersistedSession[] = [];
  try {
    const raw = sessionStorage.getItem(PERSISTED_SESSIONS_KEY);
    if (raw) records = JSON.parse(raw) as PersistedSession[];
  } catch {
    records = [];
  }
  const now = Date.now();
  const valid = records.filter((record) => (
    typeof record.requestId === "string"
    && typeof record.gameId === "string"
    && typeof record.gameName === "string"
    && typeof record.expiresAt === "number"
    && record.expiresAt > now
  ));
  if (valid.length === 0) {
    try { sessionStorage.removeItem(PERSISTED_SESSIONS_KEY); } catch { /* noop */ }
    return;
  }
  for (const record of valid) previouslyConnectedGames.add(record.gameId);
  const gameName = valid.at(-1)?.gameName ?? null;
  emit({
    phase: "reconnecting",
    gameName,
    activeSessions: 0,
    detail: "Restableciendo la sesión después de recargar Luna Negra",
  });
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    try { sessionStorage.removeItem(PERSISTED_SESSIONS_KEY); } catch { /* noop */ }
    emit({
      phase: "disconnected",
      gameName,
      activeSessions: 0,
      detail: "No se pudo restablecer la sesión de firma",
    });
    returnToStableAfter(4000);
  }, 12_000);
}

export function registerBalSignerGame(gameId: string, gameName: string): void {
  registeredGames.set(gameId, gameName);
}

export function unregisterBalSignerGame(
  gameId: string,
  gameName: string,
  preserveActiveSessions = false,
): void {
  registeredGames.delete(gameId);
  for (const [requestId, request] of pendingRequests) {
    if (request.gameId === gameId) pendingRequests.delete(requestId);
  }
  if (!preserveActiveSessions) {
    for (const [requestId, session] of activeSessions) {
      if (session.gameId === gameId) removeSession(requestId);
    }
  }
  if (preserveActiveSessions && activeSessions.size > 0) {
    emit(stableStatus());
    return;
  }
  emit({
    phase: "disconnected",
    gameName,
    activeSessions: activeSessions.size,
    detail: "El juego se desconectó del signer",
  });
  returnToStableAfter(3500);
}

/** Confirma que el remoto NIP-46 guardado volvió a escuchar tras el reload. */
export function reportBalSessionRestored(
  requestId: string,
  gameId: string,
  gameName: string,
  expiresAt: number,
): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  addSession(requestId, gameId, gameName, expiresAt);
  emit(stableStatus());
}

/** Limpia el indicador sin advertencias cuando jugar sin BAL fue intencional. */
export function disableBalSignerGame(gameId: string): void {
  registeredGames.delete(gameId);
  for (const [requestId, request] of pendingRequests) {
    if (request.gameId === gameId) {
      pendingRequests.delete(requestId);
      intentionallyDeniedRequests.delete(requestId);
    }
  }
  for (const [requestId, session] of activeSessions) {
    if (session.gameId === gameId) removeSession(requestId);
  }
  emit(stableStatus());
}

export function reportBalConnectionRequested(
  requestId: string,
  gameId: string,
  gameName: string,
): void {
  clearTransientTimer();
  intentionallyDeniedRequests.delete(requestId);
  pendingRequests.set(requestId, { gameId, gameName });
  const reconnecting = previouslyConnectedGames.has(gameId)
    || status.phase === "reconnecting";
  emit({
    phase: reconnecting ? "reconnecting" : "connecting",
    gameName,
    activeSessions: activeSessions.size,
    detail: reconnecting ? "El juego está recuperando su sesión" : "El juego solicitó una sesión de firma",
  });
}

export function reportBalAwaitingApproval(gameId: string, gameName: string): void {
  registeredGames.set(gameId, gameName);
  emit({
    phase: "awaiting_approval",
    gameName,
    activeSessions: activeSessions.size,
    detail: "Esperando tu autorización",
  });
}

export function reportBalConsentDecision(decision: "once" | "remember" | "deny"): void {
  const gameName = currentGameName();
  if (decision === "deny") {
    // Elegir jugar sin BAL es una alternativa válida, no un error del signer.
    // Guardamos el request para ignorar el BAL_ERROR/USER_REJECTED que el wire
    // usa como respuesta técnica a la negativa.
    const requestId = [...pendingRequests.keys()].at(-1);
    if (requestId) {
      pendingRequests.delete(requestId);
      intentionallyDeniedRequests.add(requestId);
    }
    emit(activeSessions.size > 0 ? stableStatus() : IDLE_STATUS);
    return;
  }
  emit({
    phase: "connecting",
    gameName,
    activeSessions: activeSessions.size,
    detail: "Creando el canal NIP-46 seguro",
  });
}

type BalMessageLike = {
  type?: unknown;
  requestId?: unknown;
  expiresAt?: unknown;
  code?: unknown;
  message?: unknown;
};

/** Observa mensajes BAL ya validados por su transporte; nunca inspecciona secretos. */
export function observeBalSignerMessage(message: unknown): void {
  const candidate = message as BalMessageLike | null;
  if (!candidate || typeof candidate !== "object" || typeof candidate.requestId !== "string") return;
  const request = pendingRequests.get(candidate.requestId);
  if (candidate.type === "BAL_SESSION" && typeof candidate.expiresAt === "number") {
    if (!request) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    addSession(candidate.requestId, request.gameId, request.gameName, candidate.expiresAt);
    pendingRequests.delete(candidate.requestId);
    emit(stableStatus());
    return;
  }
  if (candidate.type === "BAL_LOGOUT") {
    const session = removeSession(candidate.requestId);
    pendingRequests.delete(candidate.requestId);
    const gameName = session?.gameName ?? request?.gameName ?? currentGameName();
    emit({
      phase: "disconnected",
      gameName,
      activeSessions: activeSessions.size,
      detail: "La sesión de firma se cerró",
    });
    if (activeSessions.size > 0) returnToStableAfter(2200);
    return;
  }
  if (candidate.type !== "BAL_ERROR") return;
  clearTransientTimer();
  pendingRequests.delete(candidate.requestId);
  const rejected = candidate.code === "USER_REJECTED" || candidate.code === "PERMISSION_DENIED";
  if (rejected && intentionallyDeniedRequests.delete(candidate.requestId)) {
    emit(activeSessions.size > 0 ? stableStatus() : IDLE_STATUS);
    return;
  }
  const code = typeof candidate.code === "string" ? candidate.code : null;
  const errorMessage = typeof candidate.message === "string"
    ? candidate.message
    : rejected ? "La operación fue rechazada" : "El signer encontró un error";
  emit({
    phase: rejected ? "rejected" : "error",
    gameName: request?.gameName ?? currentGameName(),
    activeSessions: activeSessions.size,
    detail: code ? `[${code}] ${errorMessage}` : errorMessage,
  });
}

export function reportBalDisconnecting(detail = "Cerrando las sesiones de firma"): void {
  if (activeSessions.size === 0) return;
  emit({
    phase: "disconnecting",
    gameName: currentGameName(),
    activeSessions: activeSessions.size,
    detail,
  });
}

export async function trackBalSignerOperation<T>(
  phase: "signing" | "encrypting" | "decrypting",
  detail: string,
  operation: () => Promise<T>,
): Promise<T> {
  clearTransientTimer();
  emit({
    phase,
    gameName: currentGameName(),
    activeSessions: activeSessions.size,
    detail,
  });
  try {
    const result = await operation();
    emit({
      phase: phase === "signing" ? "signed" : "connected",
      gameName: currentGameName(),
      activeSessions: activeSessions.size,
      detail: phase === "signing" ? "Firma completada" : "Operación criptográfica completada",
    });
    returnToStableAfter(phase === "signing" ? 1400 : 700);
    return result;
  } catch (error) {
    emit({
      phase: "rejected",
      gameName: currentGameName(),
      activeSessions: activeSessions.size,
      detail: error instanceof Error ? error.message : "La operación fue rechazada",
    });
    returnToStableAfter(4500);
    throw error;
  }
}
