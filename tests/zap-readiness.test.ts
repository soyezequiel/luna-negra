import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => handler(String(input))));
}

const HEX_PUBKEY = "a".repeat(64);

describe("inspectZapEndpoint", () => {
  it("marca bad_address si no es usuario@dominio", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const { inspectZapEndpoint } = await import("@/lib/zap");
    expect(await inspectZapEndpoint("no-es-una-address")).toEqual({
      ok: false,
      reason: "bad_address",
    });
  });

  it("marca unreachable si el LNURL no responde ok", async () => {
    stubFetch(() => new Response(null, { status: 502 }));
    const { inspectZapEndpoint } = await import("@/lib/zap");
    expect(await inspectZapEndpoint("user@dominio.com")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("marca no_nip57 si el wallet no anuncia allowsNostr", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ callback: "https://dominio.com/cb", allowsNostr: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const { inspectZapEndpoint } = await import("@/lib/zap");
    expect(await inspectZapEndpoint("user@dominio.com")).toEqual({
      ok: false,
      reason: "no_nip57",
    });
  });

  it("es apto cuando anuncia allowsNostr + nostrPubkey válido", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            callback: "https://dominio.com/cb",
            allowsNostr: true,
            nostrPubkey: HEX_PUBKEY,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const { inspectZapEndpoint } = await import("@/lib/zap");
    const result = await inspectZapEndpoint("user@dominio.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpoint.nostrPubkey).toBe(HEX_PUBKEY);
      expect(result.endpoint.callback).toBe("https://dominio.com/cb");
    }
  });
});
