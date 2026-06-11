"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchProfile, profileName } from "@/lib/nostr";
import { getNostrPermsMode, warmUpPermissions } from "@/lib/nostr-social";
import { notifyOpenGameWindowsLogout } from "@/lib/room-launch";
import {
  clearActiveSigner,
  restoreSigner,
  setActiveSigner,
  type LunaSigner,
  type StoredSigner,
} from "@/lib/signer";

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
  /** Abre el modal de login (todos los métodos: extensión, QR, bunker, clave). */
  login: () => Promise<void>;
  /** Flujo challenge → firma kind:27235 → verify, con el signer elegido. */
  loginWithSigner: (signer: LunaSigner, stored: StoredSigner) => Promise<void>;
  loginModalOpen: boolean;
  closeLoginModal: () => void;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<SessionUser>) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Restaurar el signer persistido (la cookie restaura la sesión, pero firmar
    // comentarios/DMs/presencia necesita el signer en memoria).
    void restoreSigner();
  }, []);

  // Solo si el usuario eligió "autorizar todo al iniciar sesión" (modo "all"):
  // pide todos los permisos NIP-07 de una vez al establecer la sesión. En el
  // modo default ("lazy") cada función pide su permiso recién al usarse, y el
  // usuario decide en el prompt de la extensión si lo recuerda o no.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !window.nostr) return;
    if (getNostrPermsMode() !== "all") return;
    if (sessionStorage.getItem("ln_nostr_warmed")) return;
    sessionStorage.setItem("ln_nostr_warmed", "1");
    void warmUpPermissions(user.pubkey);
  }, [user]);

  // `login` ahora abre el modal con todos los métodos; los botones existentes
  // ("Conectar con Nostr" en navbar/sidebar/páginas) siguen llamándolo igual.
  const login = useCallback(async () => {
    setError(null);
    setLoginModalOpen(true);
  }, []);

  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);

  const loginWithSigner = useCallback(
    async (signer: LunaSigner, stored: StoredSigner) => {
      setError(null);
      const pubkey = await signer.getPublicKey();

      const ch = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey }),
      }).then((r) => r.json());
      if (!ch.token) throw new Error(ch.error ?? "No se pudo iniciar el login");

      const signed = await signer.signEvent({
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
      setActiveSigner(signer, stored);
      setUser(data.user);
      setLoginModalOpen(false);

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
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    notifyOpenGameWindowsLogout();
    clearActiveSigner();
    setUser(null);
  }, []);

  // Actualiza el usuario en memoria tras guardar cambios (p. ej. lud16),
  // para que el contexto no quede desincronizado con la DB.
  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <SessionContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        loginWithSigner,
        loginModalOpen,
        closeLoginModal,
        logout,
        updateUser,
      }}
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
