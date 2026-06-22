"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  clearStoredNwcUrl,
  getNwcBalanceSats,
  getStoredNwcUrl,
  isValidNwcUrl,
  probeNwc,
  setStoredNwcUrl,
} from "@/lib/nwc-wallet";

type WalletContextValue = {
  /** ¿Hay un wallet NWC conectado en este navegador? */
  connected: boolean;
  /** Saldo en sats (null mientras carga o si no hay wallet). */
  balanceSats: number | null;
  loading: boolean;
  /** Vuelve a consultar el saldo del wallet conectado. */
  refresh: () => Promise<void>;
  /** Conecta un wallet: valida, prueba el saldo y persiste en localStorage. */
  connect: (url: string) => Promise<void>;
  /** Desconecta el wallet de este navegador. */
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getStoredNwcUrl()) {
      setConnected(false);
      setBalanceSats(null);
      setLoading(false);
      return;
    }
    setConnected(true);
    setLoading(true);
    try {
      setBalanceSats(await getNwcBalanceSats());
    } catch {
      // Conexión guardada pero el relay no respondió: mantenemos "conectado"
      // pero sin saldo, para no perder la config por un fallo transitorio.
      setBalanceSats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Refresco inicial del saldo al montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const connect = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!isValidNwcUrl(trimmed)) {
        throw new Error("Conexión NWC inválida (nostr+walletconnect://…).");
      }
      // Probar antes de persistir: si el wallet no responde, no guardamos.
      const sats = await probeNwc(trimmed);
      setStoredNwcUrl(trimmed);
      setConnected(true);
      setBalanceSats(sats);
      setLoading(false);
    },
    [],
  );

  const disconnect = useCallback(() => {
    clearStoredNwcUrl();
    setConnected(false);
    setBalanceSats(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{ connected, balanceSats, loading, refresh, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet debe usarse dentro de <WalletProvider>");
  return ctx;
}
