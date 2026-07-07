import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("alertas operativas de Discord", () => {
  it("envía contexto sanitizado al webhook de alertas", async () => {
    vi.stubEnv(
      "DISCORD_ALERT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/123/test-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyOperationalError } = await import("@/lib/discord");

    await notifyOperationalError({
      source: "test-flow",
      error: new Error(
        "falló Bearer private-token https://discord.com/api/webhooks/999/secret",
      ),
      context: { betId: "bet-1", amountMsat: 18_000n },
      fingerprint: "test-alert",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    const serialized = JSON.stringify(payload);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(serialized).toContain("test-flow");
    expect(serialized).toContain("bet-1");
    expect(serialized).toContain("18000");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("/999/secret");
  });

  it("avisa un zap no social al webhook dedicado con el motivo", async () => {
    vi.stubEnv(
      "DISCORD_ZAP_WEBHOOK_URL",
      "https://discord.com/api/webhooks/456/zap-token",
    );
    vi.stubEnv(
      "DISCORD_ALERT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/123/alert-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyNonSocialZap } = await import("@/lib/discord");

    await notifyNonSocialZap({
      flow: "payout al ganador",
      reason: "La Lightning Address no anuncia soporte NIP-57",
      context: { betId: "bet-9", amountMsat: 21_000n },
      fingerprint: "zap-non-social-test",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/456/zap-token");
    const serialized = JSON.stringify(JSON.parse(String(init?.body)));
    expect(serialized).toContain("payout al ganador");
    expect(serialized).toContain("NIP-57");
    expect(serialized).toContain("bet-9");
    expect(serialized).toContain("21000");
  });

  it("cae al webhook de alertas si no hay uno dedicado de zaps", async () => {
    vi.stubEnv(
      "DISCORD_ALERT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/123/alert-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyNonSocialZap } = await import("@/lib/discord");

    await notifyNonSocialZap({
      flow: "depósito de apuesta",
      reason: "Ningún relay aceptó el recibo kind:9735",
      fingerprint: "zap-non-social-fallback",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://discord.com/api/webhooks/123/alert-token",
    );
  });

  it("deduplica la misma falla durante el cooldown", async () => {
    vi.stubEnv("DISCORD_ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/token");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyOperationalError } = await import("@/lib/discord");

    await notifyOperationalError({
      source: "scheduler",
      error: new Error("relay caído"),
      fingerprint: "same-failure",
    });
    await notifyOperationalError({
      source: "scheduler",
      error: new Error("relay caído"),
      fingerprint: "same-failure",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("diagnósticos de pago de apuestas", () => {
  it("NO reporta un éxito de rutina (depósito confirmado sin anomalías)", async () => {
    vi.stubEnv(
      "DISCORD_BET_PAYMENT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/789/bet-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyBetPaymentDiagnostic } = await import("@/lib/discord");

    await notifyBetPaymentDiagnostic({
      source: "luna-zap-bet",
      stage: "deposit-settled",
      fingerprint: "ok-1",
      context: { betId: "bet-1", sinceParticipantCreatedMs: 120_000 },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NO reporta un poll normal aunque haya liquidado depósitos", async () => {
    vi.stubEnv(
      "DISCORD_BET_PAYMENT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/789/bet-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyBetPaymentDiagnostic } = await import("@/lib/discord");

    await notifyBetPaymentDiagnostic({
      source: "luna-nwc-payment-watcher",
      stage: "poll-checked",
      fingerprint: "poll-ok",
      context: { checked: 3, settled: 2, elapsedMs: 40, intervalMs: 1_000 },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reporta una etapa de advertencia (fallback a polling)", async () => {
    vi.stubEnv(
      "DISCORD_BET_PAYMENT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/789/bet-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyBetPaymentDiagnostic } = await import("@/lib/discord");

    await notifyBetPaymentDiagnostic({
      source: "luna-nwc-payment-watcher",
      stage: "notifications-unsupported",
      fingerprint: "warn-1",
      context: { walletIndex: 0 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/789/bet-token");
    const serialized = JSON.stringify(JSON.parse(String(init?.body)));
    expect(serialized).toContain("Advertencia");
  });

  it("reporta cuando una operación anduvo lenta", async () => {
    vi.stubEnv(
      "DISCORD_BET_PAYMENT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/789/bet-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyBetPaymentDiagnostic } = await import("@/lib/discord");

    await notifyBetPaymentDiagnostic({
      source: "luna-zap-bet",
      stage: "deposit-settled",
      fingerprint: "slow-1",
      context: { betId: "bet-1", elapsedMs: 9_000 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)));
    expect(serialized).toContain("lenta");
  });

  it("reporta cuando el contexto delata un error/bug", async () => {
    vi.stubEnv(
      "DISCORD_BET_PAYMENT_WEBHOOK_URL",
      "https://discord.com/api/webhooks/789/bet-token",
    );
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notifyBetPaymentDiagnostic } = await import("@/lib/discord");

    await notifyBetPaymentDiagnostic({
      source: "luna-ngp-sync",
      stage: "sync-checked",
      fingerprint: "err-1",
      context: { checked: 4, settled: 0, errorCount: 2 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)));
    expect(serialized).toContain("Error");
  });
});
