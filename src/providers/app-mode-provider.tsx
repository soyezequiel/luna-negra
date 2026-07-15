"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  APP_MODE_STORAGE_KEY,
  getStoredAppMode,
  normalizeAppMode,
  type AppMode,
} from "@/lib/app-mode";
import { logoutBalLauncherSessions } from "@/lib/bal-launcher";

type AppModeContextValue = {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
};

const AppModeContext = createContext<AppModeContextValue | null>(null);
const APP_MODE_CHANGED_EVENT = "luna-negra:app-mode-changed";

function subscribeAppMode(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_MODE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(APP_MODE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(APP_MODE_CHANGED_EVENT, onChange);
  };
}

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  // `useSyncExternalStore` da un snapshot BAL estable al server y recupera la
  // preferencia real tras hidratar, sin efectos que provoquen renders en cascada.
  const mode = useSyncExternalStore(
    subscribeAppMode,
    getStoredAppMode,
    () => normalizeAppMode(null),
  );

  useEffect(() => {
    document.documentElement.dataset.appMode = mode;
  }, [mode]);

  const setMode = useCallback((next: AppMode) => {
    try {
      window.localStorage.setItem(APP_MODE_STORAGE_KEY, next);
    } catch {
      // La preferencia sigue vigente en memoria si el storage está bloqueado.
    }
    window.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT));
    if (next === "independent") void logoutBalLauncherSessions();
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const value = useContext(AppModeContext);
  if (!value) throw new Error("useAppMode debe usarse dentro de <AppModeProvider>");
  return value;
}
