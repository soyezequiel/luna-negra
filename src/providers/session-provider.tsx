"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchProfile, profileName } from "@/lib/nostr";
import { warmUpPermissions } from "@/lib/nostr-social";

export type SessionUser = {
  id: string;
  npub: string;
  pubkey: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  lud16?: string | null;
  isAdmin?: boolean;
};

type SessionContextValue = {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<SessionUser>) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Pide todos los permisos NIP-07 de una sola vez al establecer la sesión (login
  // o restauración por cookie), para no ir pidiéndolos por cada acción. Una vez
  // por sesión de navegador; si ya están "recordados", no muestra ningún prompt.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !window.nostr) return;
    if (sessionStorage.getItem("ln_nostr_warmed")) return;
    sessionStorage.setItem("ln_nostr_warmed", "1");
    void warmUpPermissions(user.pubkey);
  }, [user]);

  const login = useCallback(async () => {
    setError(null);
    if (!window.nostr) {
      setError("No se encontró una extensión Nostr. Instalá nos2x o Alby.");
      return;
    }
    try {
      const pubkey = await window.nostr.getPublicKey();

      const ch = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey }),
      }).then((r) => r.json());
      if (!ch.token) throw new Error(ch.error ?? "No se pudo iniciar el login");

      const signed = await window.nostr.signEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["challenge", ch.nonce]],
        content: "Iniciar sesión en Luna Negra",
      });

      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ch.token, event: signed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verificación fallida");
      setUser(data.user);

      // Cachear el perfil Nostr (kind:0) en segundo plano.
      void (async () => {
        try {
          const p = await fetchProfile(pubkey);
          if (!p) return;
          const displayName = profileName(p);
          const avatarUrl = p.picture ?? null;
          await fetch("/api/users/me/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName, avatarUrl }),
          });
          setUser((prev) => (prev ? { ...prev, displayName, avatarUrl } : prev));
        } catch {
          /* sin perfil, no pasa nada */
        }
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de login");
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  // Actualiza el usuario en memoria tras guardar cambios (p. ej. lud16),
  // para que el contexto no quede desincronizado con la DB.
  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <SessionContext.Provider
      value={{ user, loading, error, login, logout, updateUser }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return ctx;
}
