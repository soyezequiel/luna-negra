"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDmThread } from "@/hooks/use-dm-thread";
import { parseInvite, type Invite } from "@/lib/invite";

/** Panel de conversación dentro de la barra de amigos (NIP-04 sobre Nostr). */
export function FriendsChatPanel({
  friendPubkey,
  name,
  picture,
  presence,
  online,
  canInvite,
  inviteLabel,
  inviteDisabled,
  onInvite,
  onJoinRoom,
  onBack,
}: {
  friendPubkey: string;
  name: string;
  picture?: string | null;
  presence?: string | null;
  online?: boolean;
  canInvite: boolean;
  inviteLabel: string;
  inviteDisabled: boolean;
  onInvite: () => void;
  onJoinRoom: (invite: Invite) => void;
  onBack: () => void;
}) {
  const { messages, send, sending } = useDmThread(friendPubkey);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // La última invitación recibida es la única válida (las previas quedan superadas).
  const latestInviteId = useMemo(() => {
    let id: string | null = null;
    for (const m of messages ?? []) {
      if (!m.fromMe && parseInvite(m.text)) id = m.id;
    }
    return id;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function submit() {
    if (!text.trim()) return;
    void send(text);
    setText("");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          onClick={onBack}
          className="rounded-sm px-1.5 py-1 text-muted hover:bg-white/10 hover:text-white"
          aria-label="Volver a la lista"
        >
          ←
        </button>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-full bg-panel-3" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="flex items-center gap-1 text-[11px] text-faint">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: online ? "var(--online)" : "var(--faint)" }}
            />
            {presence || (online ? "en línea" : "desconectado")}
          </p>
        </div>
        {canInvite ? (
          <button
            onClick={onInvite}
            disabled={inviteDisabled}
            className="shrink-0 rounded-sm border border-green/40 px-2 py-1 text-[11px] font-medium text-green hover:bg-green/10 disabled:opacity-50"
          >
            {inviteLabel}
          </button>
        ) : null}
      </div>

      {/* Cuerpo */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages === null ? (
          <p className="text-xs text-faint">Cargando…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-faint">
            Sin mensajes todavía. Escribí el primero.
          </p>
        ) : (
          messages.map((m) => {
            const invite = parseInvite(m.text);
            const superseded = !!invite && !m.fromMe && m.id !== latestInviteId;
            return (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-ln-md px-3 py-2 text-sm ${
                  m.fromMe
                    ? "bg-ln-grad-chat ml-auto text-white"
                    : "bg-white/[0.06] text-ln-text"
                }`}
              >
                {invite ? (
                  <div className="flex flex-col gap-2">
                    <span>🎮 Invitación a una sala multijugador</span>
                    {superseded ? (
                      <span className="self-start rounded-sm bg-white/5 px-2.5 py-1 text-xs text-faint line-through">
                        Invitación reemplazada por una más nueva
                      </span>
                    ) : (
                      <button
                        onClick={() => onJoinRoom(invite)}
                        className="self-start rounded-full bg-ln-aurora/20 px-2.5 py-1 text-xs font-medium text-ln-aurora-bright hover:bg-ln-aurora/30"
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

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-ln-border p-2.5">
        <input
          className="min-w-0 flex-1 rounded-full border border-ln-border bg-ln-bg-deep px-3.5 py-2 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/25"
          placeholder="Escribí un mensaje…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="bg-ln-grad-luna flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ln-on-luna disabled:opacity-50"
          aria-label="Enviar"
        >
          {sending ? "…" : "➤"}
        </button>
      </div>
    </div>
  );
}
