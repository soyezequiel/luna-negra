"use client";

import Link from "next/link";
import { shortId } from "@/lib/nostr-social";
import { satsLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotifItem, NotifType } from "@/lib/notifications";

export const NOTIF_ICON: Record<NotifType, string> = {
  purchase: "🛒",
  zap: "⚡",
  review: "★",
  comment: "💬",
  bet: "🎲",
};
export const NOTIF_DOT: Record<NotifType, string> = {
  purchase: "var(--win)",
  zap: "var(--ln-corona)",
  review: "var(--ln-corona)",
  comment: "var(--ln-luna)",
  bet: "var(--ln-aurora)",
};

function actorOf(it: NotifItem): string {
  return it.actorName || (it.actorNpub ? shortId(it.actorNpub) : "Alguien");
}

/** Título legible de una notificación según su tipo. */
export function notifTitle(it: NotifItem): string {
  const who = actorOf(it);
  const game = it.gameTitle ?? "tu juego";
  switch (it.type) {
    case "purchase":
      return `${who} compró ${game}`;
    case "zap":
      return `${who} zapeó ${game}`;
    case "review":
      return `${who} reseñó ${game}`;
    case "comment":
      return `${who} comentó en ${game}`;
    case "bet":
      return it.text ?? "Novedad en tu apuesta";
  }
}

/** Línea secundaria (monto, estrellas, texto). */
export function notifSubtitle(it: NotifItem): string | null {
  switch (it.type) {
    case "purchase":
      return it.amountSats ? `${satsLabel(it.amountSats)} sats` : null;
    case "zap":
      return [it.amountSats ? `⚡ ${satsLabel(it.amountSats)} sats` : null, it.text]
        .filter(Boolean)
        .join(" · ");
    case "review":
      return [
        it.rating ? "★".repeat(it.rating) + "☆".repeat(5 - it.rating) : null,
        it.text,
      ]
        .filter(Boolean)
        .join(" · ");
    case "comment":
      return it.text ?? null;
    case "bet":
      return it.gameTitle ?? null;
  }
}

/**
 * Una fila de notificación. `truncate` recorta la línea secundaria a una línea
 * (dropdown de la campanita); en la página /notifications se muestra completa.
 * Si se pasa `onDismiss`, aparece una ✕ para "marcar leído y que se vaya".
 */
export function NotificationItemRow({
  it,
  unread,
  truncate = false,
  onNavigate,
  onDismiss,
  pending = false,
  onUndo,
}: {
  it: NotifItem;
  unread: boolean;
  truncate?: boolean;
  onNavigate?: () => void;
  onDismiss?: (id: string) => void;
  /** En ventana de "Deshacer": se muestra la tira en vez del contenido. */
  pending?: boolean;
  onUndo?: (id: string) => void;
}) {
  const sub = notifSubtitle(it);

  if (pending) {
    return (
      <div className="flex items-center justify-between gap-2 bg-white/[.03] px-3.5 py-3 text-[12px] text-ln-muted">
        <span>Notificación descartada</span>
        <button
          type="button"
          onClick={() => onUndo?.(it.id)}
          className="shrink-0 font-semibold text-ln-luna hover:underline"
        >
          Deshacer
        </button>
      </div>
    );
  }

  return (
    <div className={cn("group relative", unread && "bg-ln-luna/[.06]")}>
      {/* Acento de no-leído (a la izquierda, no choca con la ✕). */}
      {unread ? (
        <span
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ background: NOTIF_DOT[it.type] }}
        />
      ) : null}
      <Link
        href={it.href}
        onClick={onNavigate}
        className="flex gap-2.5 py-3 pl-3.5 pr-9 transition-colors hover:bg-white/5"
      >
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]"
          style={{ background: `color-mix(in srgb, ${NOTIF_DOT[it.type]} 18%, transparent)` }}
        >
          {NOTIF_ICON[it.type]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-snug text-ln-text">
            {notifTitle(it)}
          </span>
          {sub ? (
            <span
              className={cn(
                "mt-0.5 block text-[12px] text-ln-muted",
                truncate ? "truncate" : "whitespace-pre-wrap",
              )}
            >
              {sub}
            </span>
          ) : null}
          <span className="mt-0.5 block text-[11px] text-ln-faint">
            {timeAgo(Math.floor(it.at / 1000))}
          </span>
        </span>
      </Link>
      {onDismiss ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismiss(it.id);
          }}
          aria-label="Marcar como leída y quitar"
          title="Marcar como leída y quitar"
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ln-faint transition-colors hover:bg-white/10 hover:text-ln-text"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
