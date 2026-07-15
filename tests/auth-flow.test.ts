import { describe, expect, it } from "vitest";
import {
  detectAuthDevice,
  needsProfileOnboarding,
  profileHasName,
} from "@/lib/auth-flow";

describe("flujo de autenticación", () => {
  it("oculta extensiones en teléfonos aunque usen un viewport ancho", () => {
    expect(
      detectAuthDevice({
        userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel)",
        width: 1200,
        coarsePointer: true,
      }),
    ).toBe("mobile");
  });

  it("permite extensiones en escritorio", () => {
    expect(
      detectAuthDevice({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        width: 1440,
        coarsePointer: false,
      }),
    ).toBe("desktop");
  });

  it("acepta cualquiera de los nombres compatibles de un perfil", () => {
    expect(profileHasName({ name: "luna" })).toBe(true);
    expect(profileHasName({ display_name: "Luna" })).toBe(true);
    expect(profileHasName({ displayName: "Luna" })).toBe(true);
    expect(profileHasName({ picture: "https://example.com/a.jpg" })).toBe(false);
  });

  it("lleva identidades temporales y nsec sin nombre al onboarding", () => {
    expect(needsProfileOnboarding({ source: "generated", profile: null })).toBe(true);
    expect(
      needsProfileOnboarding({ source: "imported", profile: { picture: "x" } }),
    ).toBe(true);
    expect(
      needsProfileOnboarding({ source: "imported", profile: { name: "jugador" } }),
    ).toBe(false);
  });
});
