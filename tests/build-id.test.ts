import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildState = globalThis as typeof globalThis & {
  __lunaNegraBuildId?: string;
};

const originalBuildId = process.env.NEXT_PUBLIC_BUILD_ID;
const originalFallback = buildState.__lunaNegraBuildId;

beforeEach(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_BUILD_ID;
  delete buildState.__lunaNegraBuildId;
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalBuildId === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
  else process.env.NEXT_PUBLIC_BUILD_ID = originalBuildId;
  if (originalFallback === undefined) delete buildState.__lunaNegraBuildId;
  else buildState.__lunaNegraBuildId = originalFallback;
});

describe("BUILD_ID", () => {
  it("mantiene el fallback al reevaluarse en otro chunk", async () => {
    const first = (await import("@/lib/build-id")).BUILD_ID;

    await new Promise((resolve) => setTimeout(resolve, 2));
    vi.resetModules();
    const second = (await import("@/lib/build-id")).BUILD_ID;

    expect(second).toBe(first);
  });

  it("prioriza el identificador fijado por el deploy", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "release-123");

    expect((await import("@/lib/build-id")).BUILD_ID).toBe("release-123");
  });
});
