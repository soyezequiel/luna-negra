import { beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const records = new Map<string, string>();
  return {
    get length() { return records.size; },
    clear: () => records.clear(),
    getItem: (key) => records.get(key) ?? null,
    key: (index) => [...records.keys()][index] ?? null,
    removeItem: (key) => { records.delete(key); },
    setItem: (key, value) => { records.set(key, value); },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T20:00:00.000Z"));
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", memoryStorage());
});

describe("BAL signer navbar status", () => {
  it("tracks connection, approval, signing and disconnection", async () => {
    const status = await import("@/lib/bal-signer-status");
    status.registerBalSignerGame("ajedrez", "Ajedrez");
    status.reportBalConnectionRequested("request-1", "ajedrez", "Ajedrez");
    expect(status.getBalSignerStatusSnapshot().phase).toBe("connecting");

    status.reportBalAwaitingApproval("ajedrez", "Ajedrez");
    expect(status.getBalSignerStatusSnapshot().phase).toBe("awaiting_approval");
    status.reportBalConsentDecision("once");

    status.observeBalSignerMessage({
      type: "BAL_SESSION",
      requestId: "request-1",
      expiresAt: Date.now() + 60_000,
    });
    expect(status.getBalSignerStatusSnapshot()).toMatchObject({
      phase: "connected",
      gameName: "Ajedrez",
      activeSessions: 1,
    });

    let finishSigning!: () => void;
    const signing = status.trackBalSignerOperation(
      "signing",
      "Firmando evento kind 1",
      () => new Promise<void>((resolve) => { finishSigning = resolve; }),
    );
    expect(status.getBalSignerStatusSnapshot().phase).toBe("signing");
    finishSigning();
    await signing;
    expect(status.getBalSignerStatusSnapshot().phase).toBe("signed");
    await vi.advanceTimersByTimeAsync(1400);
    expect(status.getBalSignerStatusSnapshot().phase).toBe("connected");

    status.observeBalSignerMessage({ type: "BAL_LOGOUT", requestId: "request-1" });
    expect(status.getBalSignerStatusSnapshot()).toMatchObject({
      phase: "disconnected",
      activeSessions: 0,
    });
  });

  it("shows a rejected request without inventing an active session", async () => {
    const status = await import("@/lib/bal-signer-status");
    status.registerBalSignerGame("ajedrez", "Ajedrez");
    status.reportBalConnectionRequested("request-2", "ajedrez", "Ajedrez");
    status.reportBalConsentDecision("deny");

    expect(status.getBalSignerStatusSnapshot()).toMatchObject({
      phase: "rejected",
      activeSessions: 0,
      gameName: "Ajedrez",
    });
  });

  it("keeps the exact BAL error visible until another state change", async () => {
    const status = await import("@/lib/bal-signer-status");
    status.registerBalSignerGame("ajedrez", "Ajedrez");
    status.reportBalConnectionRequested("request-error", "ajedrez", "Ajedrez");

    status.observeBalSignerMessage({
      type: "BAL_ERROR",
      requestId: "request-error",
      code: "NO_ACTIVE_IDENTITY",
      message: "Luna Negra no tiene una identidad BAL activa",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(status.getBalSignerStatusSnapshot()).toMatchObject({
      phase: "error",
      gameName: "Ajedrez",
      activeSessions: 0,
      detail: "[NO_ACTIVE_IDENTITY] Luna Negra no tiene una identidad BAL activa",
    });
  });
});
