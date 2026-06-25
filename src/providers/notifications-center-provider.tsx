"use client";

import type { ReactNode } from "react";
import {
  NotificationsCenterContext,
  useNotificationsCenterData,
} from "@/hooks/use-notifications-center";

/**
 * Corre UNA sola vez la carga del centro de notificaciones (feed de DB +
 * comentarios Nostr) y la comparte con la campanita del navbar y la página
 * /notifications vía `useNotificationsCenter()`. Centralizarla evita que cada
 * vista dispare su propia tanda de consultas a relays.
 */
export function NotificationsCenterProvider({ children }: { children: ReactNode }) {
  const value = useNotificationsCenterData();
  return (
    <NotificationsCenterContext.Provider value={value}>
      {children}
    </NotificationsCenterContext.Provider>
  );
}
