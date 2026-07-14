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
  it("recupera la cuenta de sesión que corresponde a la nsec activa", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", {});
    const secret = generateSecretKey();
    const pubkey = getPublicKey(secret);
    const { createLocalSigner, matchSignerToSessionUser } = await import("@/lib/signer");
    const refreshUser = vi.fn(async () => ({ id: "new", pubkey }));

    const identity = await matchSignerToSessionUser({
      signer: createLocalSigner(secret),
      user: { id: "stale", pubkey: "a".repeat(64) },
      refreshUser,
    });

    expect(refreshUser).toHaveBeenCalledOnce();
    expect(identity).toEqual({ user: { id: "new", pubkey }, pubkey });
  });

  it("no presta BAL si la cookie sigue perteneciendo a otra clave", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", {});
    const { createLocalSigner, matchSignerToSessionUser } = await import("@/lib/signer");

    await expect(matchSignerToSessionUser({
      signer: createLocalSigner(generateSecretKey()),
      user: { pubkey: "a".repeat(64) },
      refreshUser: async () => ({ pubkey: "b".repeat(64) }),
    })).resolves.toBeNull();
  });

  it("resuelve BAL para una nsec importada y para un complemento NIP-07", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", {});
    const { resolveBalIdentitySource } = await import("@/lib/signer");

    expect(resolveBalIdentitySource({
      custodial: false,
      signerMethod: "local",
      localSource: "imported",
    })).toBe("nsec");
    expect(resolveBalIdentitySource({
      custodial: false,
      signerMethod: "local",
      localSource: "generated",
    })).toBe("nsec");
    expect(resolveBalIdentitySource({
      custodial: false,
      signerMethod: "local",
      localSource: null,
    })).toBe("nsec");
    expect(resolveBalIdentitySource({
      custodial: true,
      signerMethod: "local",
      localSource: null,
    })).toBe("email");
    expect(resolveBalIdentitySource({
      custodial: false,
      signerMethod: "nip07",
      localSource: null,
    })).toBe("nip07");
    expect(resolveBalIdentitySource({
      custodial: false,
      signerMethod: "nip46",
      localSource: null,
    })).toBeNull();
  });

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
