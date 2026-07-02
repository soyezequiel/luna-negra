"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useDmThread } from "@/hooks/use-dm-thread";
import { parseInvite, latestJoinableInviteId, type Invite } from "@/lib/invite";
import { Avatar } from "@/components/ui/avatar";
import { formatDayLabel, formatTime, sameDay } from "@/lib/format-chat";
import { cn } from "@/lib/utils";

/** Chip de separador de día entre grupos de mensajes (NIP-04). */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-faint">
        {label}
      </span>
    </div>
  );
}

/**
 * Esqueleton de burbujas mientras llegan los mensajes que aún no están en caché.
 * Alterna lados para sugerir una conversación cargándose.
 */
function ChatSkeleton() {
  const rows = [
    { mine: false, w: "60%" },
    { mine: true, w: "45%" },
    { mine: false, w: "72%" },
    { mine: true, w: "38%" },
    { mine: false, w: "55%" },
  ];
  return (
    <div className="space-y-2" aria-hidden>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "h-8 animate-pulse rounded-ln-md bg-white/[0.06]",
            r.mine && "ml-auto",
          )}
          style={{ width: r.w }}
        />
      ))}
    </div>
  );
}

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
  const { messages, loading, send, sending } = useDmThread(friendPubkey);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // La última invitación recibida es la única válida (las previas quedan superadas).
  // Cubre invitaciones NIP-04 (link en el texto) y retos NIP-17 (gameUrl).
  const latestInviteId = useMemo(
    () => latestJoinableInviteId(messages ?? []),
    [messages],
  );

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
        <Avatar src={picture} seed={name} className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="flex items-center gap-1 text-[11px] text-faint">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: online ? "var(--online)" : "var(--faint)" }}
            />
            {presence || (online ? "conectado" : "desconectado")}
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
        {messages === null || messages.length === 0 ? (
          // Sin caché todavía: esqueleton mientras llegan los relays; si ya
          // terminó de cargar y no hay nada, el aviso de chat vacío.
          loading ? (
            <ChatSkeleton />
          ) : (
            <p className="text-xs text-faint">
              Sin mensajes todavía. Escribí el primero.
            </p>
          )
        ) : (
          <>
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDay =
                !prev || !sameDay(prev.created_at, m.created_at);
              const invite = parseInvite(m.text);
              const superseded =
                !!invite && !m.fromMe && m.id !== latestInviteId;
              return (
                <Fragment key={m.id}>
                  {showDay ? (
                    <DayDivider label={formatDayLabel(m.created_at)} />
                  ) : null}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-ln-md px-3 py-2 text-sm",
                      m.fromMe
                        ? "bg-ln-grad-chat ml-auto text-white"
                        : "bg-white/[0.06] text-ln-text",
                    )}
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
                    ) : m.gameUrl ? (
                      // Reto NIP-17: el link de sala vive en el tag `url` del rumor.
                      // Solo el reto más nuevo de este usuario ofrece entrar; los
                      // anteriores quedan superados (la partida vieja ya no vale).
                      <div className="flex flex-col gap-2">
                        <span>{m.text}</span>
                        {!m.fromMe && m.id !== latestInviteId ? (
                          <span className="self-start rounded-sm bg-white/5 px-2.5 py-1 text-xs text-faint line-through">
                            Reto reemplazado por uno más nuevo
                          </span>
                        ) : (
                          <a
                            href={m.gameUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="self-start rounded-full bg-ln-aurora/20 px-2.5 py-1 text-xs font-medium text-ln-aurora-bright hover:bg-ln-aurora/30"
                          >
                            🎮 Unirse a la partida
                          </a>
                        )}
                      </div>
                    ) : (
                      m.text
                    )}
                    {/* Hora discreta: la fecha la da el separador de día. */}
                    <span
                      className={cn(
                        "mt-0.5 block text-right text-[10px] tabular-nums",
                        m.fromMe ? "text-white/55" : "text-faint",
                      )}
                    >
                      {formatTime(m.created_at)}
                    </span>
                  </div>
                </Fragment>
              );
            })}
            {/* Caché pintado pero seguimos trayendo lo que falta de los relays. */}
            {loading ? (
              <div className="pt-1 opacity-70">
                <ChatSkeleton />
              </div>
            ) : null}
          </>
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
