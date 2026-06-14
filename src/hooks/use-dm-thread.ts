"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import {
  fetchDmEvents,
  dmCounterpart,
  decryptDm,
  sendDm,
  subscribeDms,
} from "@/lib/nostr-social";
import {
  getCachedThread,
  saveCachedThread,
  getCachedDecryption,
  cacheDecryptions,
  type DmMessage,
} from "@/lib/dm-cache";

export type { DmMessage } from "@/lib/dm-cache";

/**
 * Hilo de DMs con un contacto. Reutiliza los helpers de cifrado de
 * `nostr-social` (los mismos que usa /messages) — no duplica lógica de NIP-04.
 * Usado por el chat embebido en la barra de amigos.
 *
 * Cacheo (ver `dm-cache.ts`): al abrir un chat pintamos al instante los mensajes
 * cacheados (sin esperar a los relays) y refrescamos en segundo plano. El
 * descifrado se cachea por evento, así que cada refresco solo descifra lo nuevo.
 * `loading` indica que hay un fetch en curso (para mostrar el esqueleton).
 */
export function useDmThread(counterpart: string | null) {
  const { user } = useSession();
  // Seed síncrono desde el caché: el primer render ya muestra el historial.
  const [messages, setMessages] = useState<DmMessage[] | null>(() =>
    user && counterpart ? getCachedThread(user.pubkey, counterpart) : null,
  );
  // Arranca en true si hay un contacto: el fetch viene en el effect y así no
  // parpadea "Sin mensajes" antes de mostrar el esqueleton.
  const [loading, setLoading] = useState(() => Boolean(user && counterpart));
  const [sending, setSending] = useState(false);

  // Al cambiar de contacto, re-sembramos desde el caché en render (sin effect).
  const [prevKey, setPrevKey] = useState<string | null>(
    user && counterpart ? `${user.pubkey}:${counterpart}` : null,
  );
  const key = user && counterpart ? `${user.pubkey}:${counterpart}` : null;
  if (key !== prevKey) {
    setPrevKey(key);
    setMessages(
      user && counterpart ? getCachedThread(user.pubkey, counterpart) : null,
    );
    setLoading(Boolean(user && counterpart));
  }

  const load = useCallback(async () => {
    if (!user || !counterpart) {
      setMessages(null);
      return;
    }
    setLoading(true);
    try {
      const evs = (await fetchDmEvents(user.pubkey))
        .filter((e) => dmCounterpart(e, user.pubkey) === counterpart)
        .sort((a, b) => a.created_at - b.created_at);
      const out: DmMessage[] = [];
      const freshlyDecrypted: Array<{ id: string; text: string }> = [];
      for (const e of evs) {
        // Reutilizamos el descifrado cacheado: evita re-pedir permiso NIP-07 y
        // re-descifrar en cada refresco.
        let text = getCachedDecryption(user.pubkey, e.id);
        if (text === undefined) {
          text = await decryptDm(e, user.pubkey);
          freshlyDecrypted.push({ id: e.id, text });
        }
        out.push({
          id: e.id,
          fromMe: e.pubkey === user.pubkey,
          text,
          created_at: e.created_at,
        });
      }
      if (freshlyDecrypted.length) cacheDecryptions(user.pubkey, freshlyDecrypted);
      saveCachedThread(user.pubkey, counterpart, out);
      setMessages(out);
    } finally {
      setLoading(false);
    }
  }, [user, counterpart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Suscripción en vivo: al llegar un DM del contacto activo, recargamos el hilo.
  useEffect(() => {
    if (!user || !counterpart) return;
    const sub = subscribeDms(user.pubkey, (ev) => {
      if (ev.pubkey === counterpart) setTimeout(load, 600);
    });
    return () => sub.close();
  }, [user, counterpart, load]);

  const send = useCallback(
    async (text: string) => {
      if (!user || !counterpart || !text.trim()) return;
      setSending(true);
      try {
        await sendDm(counterpart, text.trim());
        setTimeout(load, 1200);
      } finally {
        setSending(false);
      }
    },
    [user, counterpart, load],
  );

  return { messages, loading, send, sending, reload: load };
}
