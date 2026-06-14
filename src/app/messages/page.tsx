"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { Button } from "@/components/ui/button";
import { parseInvite, type Invite } from "@/lib/invite";
import {
  joinRoomAndPlay,
  POPUP_BLOCKED_BODY,
  POPUP_BLOCKED_TITLE,
} from "@/lib/room-launch";
import {
  fetchDmEvents,
  dmCounterpart,
  decryptDm,
  sendDm,
  fetchProfiles,
  profileName,
  npubOf,
  shortId,
  pubkeyFromNpub,
  type Profile,
} from "@/lib/nostr-social";
import type { Event } from "nostr-tools";

type Msg = { id: string; fromMe: boolean; text: string; created_at: number };

export default function MessagesPage() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const [events, setEvents] = useState<Event[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [newNpub, setNewNpub] = useState("");
  const [sending, setSending] = useState(false);
  const [, startLoadTransition] = useTransition();
  const [, startSelectionTransition] = useTransition();
  const [, startThreadTransition] = useTransition();

  // Aceptar una invitación: reutilizar el juego abierto o preabrir una pestaña
  // dentro del click si todavía no existe.
  function joinRoom(invite: Invite) {
    void joinRoomAndPlay({
      slug: invite.slug,
      roomId: invite.roomId,
      onError: (body) => notify({ title: "No se pudo unir a la sala", body: body ?? undefined }),
      onBlocked: (dest) =>
        notify({
          title: POPUP_BLOCKED_TITLE,
          body: POPUP_BLOCKED_BODY,
          href: dest,
          kind: "warn",
          actionLabel: "Abrir juego",
        }),
    });
  }

  const load = useCallback(async () => {
    if (!user) return;
    const evs = await fetchDmEvents(user.pubkey);
    setEvents(evs);
    const counterparts = [
      ...new Set(evs.map((e) => dmCounterpart(e, user.pubkey)).filter(Boolean)),
    ];
    if (counterparts.length) setProfiles(await fetchProfiles(counterparts));
  }, [user]);

  useEffect(() => {
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

  // Abrir conversación desde ?to=npub
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to) {
      const pk = pubkeyFromNpub(to);
      if (pk) {
        startSelectionTransition(() => {
          setSelected(pk);
        });
      }
    }
  }, [startSelectionTransition]);

  const conversations = useMemo(() => {
    if (!user) return [];
    const m = new Map<string, number>();
    for (const ev of events) {
      const cp = dmCounterpart(ev, user.pubkey);
      if (!cp) continue;
      m.set(cp, Math.max(m.get(cp) ?? 0, ev.created_at));
    }
    return [...m.entries()]
      .map(([pubkey, last]) => ({ pubkey, last }))
      .sort((a, b) => b.last - a.last);
  }, [events, user]);

  // Descifrar el hilo seleccionado
  useEffect(() => {
    if (!user || !selected) {
      startThreadTransition(() => {
        setThread([]);
      });
      return;
    }
    const evs = events
      .filter((e) => dmCounterpart(e, user.pubkey) === selected)
      .sort((a, b) => a.created_at - b.created_at);
    let cancelled = false;
    (async () => {
      const out: Msg[] = [];
      for (const e of evs) {
        out.push({
          id: e.id,
          fromMe: e.pubkey === user.pubkey,
          text: await decryptDm(e, user.pubkey),
          created_at: e.created_at,
        });
      }
      if (!cancelled) {
        startThreadTransition(() => {
          setThread(out);
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [events, selected, user, startThreadTransition]);

  // Solo la última invitación recibida en este chat es válida; las anteriores
  // quedan invalidadas. El hilo está ordenado ascendente, así que la última que
  // coincide es la más nueva. (Se aplica a las recibidas, no a las que envié yo.)
  const latestInviteId = useMemo(() => {
    let id: string | null = null;
    for (const m of thread) {
      if (!m.fromMe && parseInvite(m.text)) id = m.id;
    }
    return id;
  }, [thread]);

  async function send() {
    if (!selected || !text.trim()) return;
    setSending(true);
    try {
      await sendDm(selected, text.trim());
      setText("");
      setTimeout(load, 1200);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  function startNew() {
    const pk = pubkeyFromNpub(newNpub);
    if (!pk) return alert("npub inválido");
    setSelected(pk);
    setNewNpub("");
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Mensajes</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para chatear.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const nameFor = (pk: string) => profileName(profiles[pk], shortId(npubOf(pk)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold text-white">Mensajes</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[260px_1fr]">
        {/* Lista de conversaciones */}
        <aside className="rounded-lg border border-line bg-panel p-3">
          <div className="mb-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-sm border border-line bg-black/20 px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-blue/30"
              placeholder="npub para iniciar chat"
              value={newNpub}
              onChange={(e) => setNewNpub(e.target.value)}
            />
            <Button variant="ghost" onClick={startNew}>
              +
            </Button>
          </div>
          {conversations.length === 0 ? (
            <p className="px-1 text-xs text-faint">Sin conversaciones.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.pubkey}>
                  <button
                    onClick={() => setSelected(c.pubkey)}
                    className={`w-full truncate rounded-sm px-2 py-2 text-left text-sm ${
                      selected === c.pubkey
                        ? "bg-blue/20 text-white"
                        : "text-ink hover:bg-white/5"
                    }`}
                  >
                    {nameFor(c.pubkey)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Hilo */}
        <section className="flex min-h-[420px] flex-col rounded-lg border border-line bg-panel">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-faint">
              Elegí una conversación o iniciá una con un npub.
            </div>
          ) : (
            <>
              <header className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
                {nameFor(selected)}
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {thread.length === 0 ? (
                  <p className="text-sm text-faint">
                    Sin mensajes todavía. Escribí el primero.
                  </p>
                ) : (
                  thread.map((m) => {
                    const invite = parseInvite(m.text);
                    // Invitación recibida superada por otra más nueva del chat.
                    const superseded =
                      !!invite && !m.fromMe && m.id !== latestInviteId;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[80%] rounded-ln-md px-3 py-2 text-sm ${
                          m.fromMe
                            ? "bg-ln-grad-chat ml-auto text-white"
                            : "bg-white/[0.06] text-ln-text"
                        }`}
                      >
                        {invite ? (
                          <div className="flex flex-col gap-2">
                            <span>🎮 Invitación a una sala multijugador</span>
                            {superseded ? (
                              <span className="self-start rounded-sm bg-white/5 px-3 py-1.5 text-xs font-medium text-faint line-through">
                                Invitación reemplazada por una más nueva
                              </span>
                            ) : (
                              <button
                                onClick={() => joinRoom(invite)}
                                className="self-start rounded-sm bg-green/20 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/30"
                              >
                                Unirse a la sala
                              </button>
                            )}
                          </div>
                        ) : (
                          m.text
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex gap-2 border-t border-line p-3">
                <input
                  className="min-w-0 flex-1 rounded-full border border-line bg-black/30 px-3.5 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                  placeholder="Escribí un mensaje…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                />
                <Button variant="blue" onClick={send} disabled={sending}>
                  {sending ? "…" : "Enviar"}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      <p className="mt-4 text-xs text-faint">
        Chat cifrado con NIP-04 sobre Nostr. Tu extensión puede pedirte permiso
        para descifrar cada mensaje.
      </p>
    </div>
  );
}
