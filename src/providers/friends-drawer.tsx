"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

/**
 * Estado del drawer de amigos en móvil (<880px). La barra de amigos vive como
 * aside fijo en desktop y como drawer deslizable en móvil; la tab bar inferior
 * lo abre desde la pestaña "Amigos". En desktop este estado se ignora.
 */
type FriendsDrawerValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const FriendsDrawerContext = createContext<FriendsDrawerValue | null>(null);

export function FriendsDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cerrar el drawer al navegar entre pantallas. Patrón "ajustar estado en
  // render" (recomendado por React) en vez de un effect con setState.
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    if (open) setOpen(false);
  }

  // Bloquear el scroll del body mientras el drawer está abierto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  return (
    <FriendsDrawerContext.Provider value={value}>
      {children}
    </FriendsDrawerContext.Provider>
  );
}

export function useFriendsDrawer(): FriendsDrawerValue {
  const ctx = useContext(FriendsDrawerContext);
  if (!ctx)
    throw new Error(
      "useFriendsDrawer debe usarse dentro de <FriendsDrawerProvider>",
    );
  return ctx;
}
