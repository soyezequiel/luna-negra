"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Toggle "solo amigos en Luna Negra", compartido entre la página /friends y el
 * sidebar y persistido en localStorage. Usa un store externo (evento propio +
 * `storage`) para que ambas vistas —y otras pestañas— se mantengan en sincronía
 * sin duplicar estado.
 */
const KEY = "friends:onlyMembers";
const EVENT = "friends:onlyMembers-change";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(value: boolean) {
  try {
    window.localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* storage no disponible / cuota: ignorar */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  // Evento propio: sincroniza componentes dentro de la misma pestaña.
  // `storage`: sincroniza entre pestañas (no dispara en la pestaña que escribe).
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useOnlyMembers(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => false);
  const setValue = useCallback((next: boolean) => write(next), []);
  return [value, setValue];
}
