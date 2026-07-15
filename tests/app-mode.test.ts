import { describe, expect, it, vi } from "vitest";
import {
  APP_MODE_STORAGE_KEY,
  getStoredAppMode,
  normalizeAppMode,
} from "@/lib/app-mode";

describe("selector de modo", () => {
  it("mantiene BAL como default seguro y acepta solo el modo independiente", () => {
    expect(normalizeAppMode(null)).toBe("bal");
    expect(normalizeAppMode("otro")).toBe("bal");
    expect(normalizeAppMode("independent")).toBe("independent");
  });

  it("recupera la preferencia guardada entre sesiones", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === APP_MODE_STORAGE_KEY ? "independent" : null,
        ),
      },
    });
    expect(getStoredAppMode()).toBe("independent");
    vi.unstubAllGlobals();
  });
});
