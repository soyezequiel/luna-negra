"use client";

/**
 * Beacon de presencia "online en la tienda". Mientras hay un usuario logueado y
 * la pestaña está visible, manda un heartbeat a POST /api/me/presence cada ~30s.
 * Pausa cuando la pestaña se oculta (no inflar concurrencia con pestañas de
 * fondo) y dispara un ping al volver a primer plano. No renderiza nada.
 *
 * El conteo de concurrentes se muestrea server-side (store-presence-sampler) y se
 * grafica en /admin/visitors.
 */

import { useEffect } from "react";
import { useSession } from "@/providers/session-provider";

const HEARTBEAT_MS = 30_000;

export function StorePresenceBeacon() {
  const { user } = useSession();
  const loggedIn = Boolean(user);

  useEffect(() => {
    if (!loggedIn) return;

    let stopped = false;
    const ping = () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // keepalive: el ping sobrevive si el usuario navega/cierra justo después.
      void fetch("/api/me/presence", { method: "POST", keepalive: true }).catch(() => {});
    };

    ping(); // marca online de entrada
    const id = setInterval(ping, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loggedIn]);

  return null;
}
