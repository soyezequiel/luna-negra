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
import { reconcilePlayingPresence } from "@/lib/playing-presence";

const HEARTBEAT_MS = 30_000;

export function StorePresenceBeacon() {
  const { user } = useSession();
  const loggedIn = Boolean(user);
  const pubkey = user?.pubkey;

  // Al abrir la tienda: si quedó un estado NIP-38 "jugando X" colgado de una
  // sesión previa y la API confirma que ya no estás jugando, lo limpia para que
  // los amigos no te vean como jugando algo que cerraste. Corre una vez por carga.
  useEffect(() => {
    if (!pubkey) return;
    void reconcilePlayingPresence(pubkey);
  }, [pubkey]);

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

    // Al cerrar/navegar la pestaña, avisamos "me fui" para que los amigos nos vean
    // desconectar casi en vivo, sin esperar a que venza el TTL del heartbeat (~75s).
    // `sendBeacon` está pensado para esto: sale aunque la página se esté cerrando
    // (fetch keepalive puede cancelarse). Sólo POST, así que el offline va por query.
    const onPageHide = () => {
      if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
      navigator.sendBeacon("/api/me/presence?offline=1");
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [loggedIn]);

  return null;
}
