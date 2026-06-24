"use client";

import type { ReactNode } from "react";
import { FriendsContext, useFriendsData } from "@/hooks/use-friends";

/**
 * Corre UNA sola vez la carga de amigos (contactos + perfiles + estados +
 * /api/users/known) y la comparte con todos los consumidores de `useFriends()`.
 *
 * Antes, la barra lateral (`FriendsSidebar`, montada en el layout) y el riel del
 * home (`SocialRail`) llamaban a `useFriends` por separado: cada uno disparaba la
 * tormenta de consultas a relays en paralelo, duplicando la descarga al iniciar
 * sesión y saturando el navegador. Centralizándola acá, la barra de amigos pesa
 * lo mismo sin importar cuántos componentes la muestren.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const value = useFriendsData();
  return (
    <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
  );
}
