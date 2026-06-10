"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSession } from "@/providers/session-provider";
import {
  fetchDmEvents,
  dmCounterpart,
  decryptDm,
  sendDm,
  subscribeDms,
} from "@/lib/nostr-social";

export type DmMessage = {
  id: string;
  fromMe: boolean;
  text: string;
  created_at: number;
};

/**
 * Hilo de DMs con un contacto. Reutiliza los helpers de cifrado de
 * `nostr-social` (los mismos que usa /messages) — no duplica lógica de NIP-04.
 * Usado por el chat embebido en la barra de amigos.
 */
export function useDmThread(counterpart: string | null) {
  const { user } = useSession();
  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    if (!user || !counterpart) {
      setMessages(null);
      return;
    }
    const evs = (await fetchDmEvents(user.pubkey))
      .filter((e) => dmCounterpart(e, user.pubkey) === counterpart)
      .sort((a, b) => a.created_at - b.created_at);
    const out: DmMessage[] = [];
    for (const e of evs) {
      out.push({
        id: e.id,
        fromMe: e.pubkey === user.pubkey,
        text: await decryptDm(e, user.pubkey),
        created_at: e.created_at,
      });
    }
    setMessages(out);
  }, [user, counterpart]);

  useEffect(() => {
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

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

  return { messages, send, sending, reload: load };
}
