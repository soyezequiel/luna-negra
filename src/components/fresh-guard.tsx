"use client";

import { useEffect, useRef } from "react";

/**
 * Garantiza que el visitante no se quede mirando una versión vieja del sitio
 * sin tener que limpiar nada de su lado. Cubre dos casos que el
 * `Cache-Control: no-store` del servidor NO resuelve:
 *
 *  1. bfcache (back/forward cache): al volver "atrás"/"adelante" o reabrir una
 *     pestaña suspendida, el navegador restaura un snapshot en memoria que
 *     ignora `no-store`. El listener de `pageshow`/`persisted` lo recarga.
 *
 *  2. Pestaña abierta y visible durante un deploy: nunca dispara `pageshow`, así
 *     que sondeamos `/api/version` y, si el build cambió respecto al que cargó
 *     esta página, recargamos. El sondeo corre al volver el foco/visibilidad y
 *     cada `POLL_MS` mientras la pestaña está visible.
 *
 * Ninguno genera bucles: el reload produce una navegación normal (pageshow con
 * `persisted === false`) que vuelve a cargar el build actual.
 */

const POLL_MS = 5 * 60 * 1000;

export function FreshGuard({ version }: { version: string }) {
  const reloading = useRef(false);

  useEffect(() => {
    const reload = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reload();
    };

    const checkVersion = async () => {
      if (document.visibilityState !== "visible" || reloading.current) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { v?: string };
        if (data.v && data.v !== version) reload();
      } catch {
        // Sin red o el server reiniciando: reintentamos en el próximo ciclo.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkVersion();
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    const id = window.setInterval(checkVersion, POLL_MS);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(id);
    };
  }, [version]);

  return null;
}
