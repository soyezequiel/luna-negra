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
