"use client";

const CLOSE_WARNING =
  "Luna Negra está funcionando como firmante. Si cerrás esta pestaña, los juegos perderán la sesión de firma.";

type BalMessageLike = {
  type?: unknown;
  requestId?: unknown;
  expiresAt?: unknown;
};

/**
 * Mantiene el aviso de cierre ligado a sesiones BAL realmente activas.
 * Los navegadores modernos muestran texto propio en el diálogo beforeunload,
 * pero `returnValue` conserva el mensaje para los que todavía lo admiten.
 */
export class BalSessionGuard {
  private readonly sessions = new Map<string, ReturnType<typeof setTimeout> | null>();
  private started = false;

  constructor(private readonly target: Window) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.target.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  observe(message: unknown): void {
    const candidate = message as BalMessageLike | null;
    if (!candidate || typeof candidate !== "object" || typeof candidate.requestId !== "string") return;
    if (candidate.type === "BAL_SESSION") {
      const expiresAt = typeof candidate.expiresAt === "number" ? candidate.expiresAt : null;
      this.add(candidate.requestId, expiresAt);
    } else if (candidate.type === "BAL_LOGOUT") {
      this.remove(candidate.requestId);
    }
  }

  hasActiveSessions(): boolean {
    return this.sessions.size > 0;
  }

  stop(): void {
    if (this.started) {
      this.target.removeEventListener("beforeunload", this.handleBeforeUnload);
      this.started = false;
    }
    for (const timer of this.sessions.values()) if (timer) clearTimeout(timer);
    this.sessions.clear();
  }

  private add(requestId: string, expiresAt: number | null): void {
    this.remove(requestId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (expiresAt !== null) {
      const remaining = Math.max(0, expiresAt - Date.now());
      timer = setTimeout(() => this.remove(requestId), remaining);
    }
    this.sessions.set(requestId, timer);
  }

  private remove(requestId: string): void {
    const timer = this.sessions.get(requestId);
    if (timer) clearTimeout(timer);
    this.sessions.delete(requestId);
  }

  private readonly handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.hasActiveSessions()) return;
    event.preventDefault();
    event.returnValue = CLOSE_WARNING;
  };
}

