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
 */
export function NotificationItemRow({
  it,
  unread,
  truncate = false,
  onNavigate,
}: {
  it: NotifItem;
  unread: boolean;
  truncate?: boolean;
  onNavigate?: () => void;
}) {
  const sub = notifSubtitle(it);
  return (
    <Link
      href={it.href}
      onClick={onNavigate}
      className={cn(
        "flex gap-2.5 px-3.5 py-3 transition-colors hover:bg-white/5",
        unread && "bg-ln-luna/[.06]",
      )}
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
      {unread ? (
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: NOTIF_DOT[it.type] }}
        />
      ) : null}
    </Link>
  );
}
