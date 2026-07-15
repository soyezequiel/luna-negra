export const APP_MODE_STORAGE_KEY = "luna-negra:app-mode.v1";

export type AppMode = "bal" | "independent";

export function normalizeAppMode(value: unknown): AppMode {
  return value === "independent" ? "independent" : "bal";
}

/** Lee la preferencia en código cliente; BAL conserva el comportamiento previo. */
export function getStoredAppMode(): AppMode {
  if (typeof window === "undefined") return "bal";
  try {
    return normalizeAppMode(window.localStorage.getItem(APP_MODE_STORAGE_KEY));
  } catch {
    return "bal";
  }
}
