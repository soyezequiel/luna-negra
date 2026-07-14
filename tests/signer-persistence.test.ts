import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("persistencia del signer", () => {
  it("restaura una clave local después de recargar el módulo", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {});
    const secret = generateSecretKey();
    const nsec = nip19.nsecEncode(secret);

    const firstLoad = await import("@/lib/signer");
    firstLoad.setActiveSigner(firstLoad.createLocalSigner(secret), {
      method: "local",
      nsec,
      source: "imported",
    });

    vi.resetModules();
    const secondLoad = await import("@/lib/signer");
    const restored = await secondLoad.restoreSigner();

    expect(await restored?.getPublicKey()).toBe(getPublicKey(secret));
    expect(restored?.method).toBe("local");
  });

  it("espera la inyección tardía de NIP-07 y deduplica la restauración", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.setItem("ln_signer", JSON.stringify({ method: "nip07" }));
    vi.stubGlobal("localStorage", storage);
    const provider = {
      getPublicKey: vi.fn(async () => "a".repeat(64)),
      signEvent: vi.fn(),
    };
    const browserWindow: { nostr?: typeof provider } = {};
    vi.stubGlobal("window", browserWindow);
    const { restoreSigner } = await import("@/lib/signer");

    const first = restoreSigner();
    const second = restoreSigner();
    expect(second).toBe(first);

    browserWindow.nostr = provider;
    await vi.advanceTimersByTimeAsync(100);
    const restored = await first;

    expect(restored?.method).toBe("nip07");
    await expect(restored?.getPublicKey()).resolves.toBe("a".repeat(64));
  });

  it("no resucita el signer si el usuario cierra sesión durante la restauración", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.setItem("ln_signer", JSON.stringify({ method: "nip07" }));
    vi.stubGlobal("localStorage", storage);
    const browserWindow: {
      nostr?: { getPublicKey: () => Promise<string>; signEvent: ReturnType<typeof vi.fn> };
    } = {};
    vi.stubGlobal("window", browserWindow);
    const { clearActiveSigner, getActiveSigner, restoreSigner } = await import("@/lib/signer");

    const restoring = restoreSigner();
    clearActiveSigner();
    browserWindow.nostr = {
      getPublicKey: async () => "b".repeat(64),
      signEvent: vi.fn(),
    };
    await vi.advanceTimersByTimeAsync(100);

    await expect(restoring).resolves.toBeNull();
    expect(getActiveSigner()).toBeNull();
    expect(storage.getItem("ln_signer")).toBeNull();
  });
});
