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

type BetResult = NonNullable<NotifItem["betResult"]>;

/** Ícono, color y título propios de cada desenlace de apuesta. */
const BET_META: Record<BetResult, { icon: string; dot: string; title: string }> = {
  won: { icon: "🏆", dot: "var(--win)", title: "Ganaste tu apuesta" },
  lost: { icon: "✕", dot: "var(--lose)", title: "Perdiste tu apuesta" },
  tie: { icon: "🤝", dot: "var(--ln-luna)", title: "Empate en tu apuesta" },
  claimable: { icon: "💰", dot: "var(--ln-corona)", title: "Premio listo para cobrar" },
};

function betResultOf(it: NotifItem): BetResult {
  if (it.betResult) return it.betResult;
  // Ítems sin el campo estructurado (respuestas viejas): se infiere del texto.
  const t = it.text ?? "";
  if (t.includes("premio")) return "claimable";
  if (t.startsWith("Ganaste")) return "won";
  if (t.includes("empate")) return "tie";
  return "lost";
}

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
      return BET_META[betResultOf(it)].title;
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
    case "bet": {
      const dest = it.payoutDestination
        ? `💸 ${it.payoutDestination}${it.payoutKind === "lnurl" ? " (sin recibo Nostr)" : ""}`
        : null;
      return [it.gameTitle, dest].filter(Boolean).join(" · ") || null;
    }
  }
}

/**
 * Una fila de notificación. `truncate` recorta la línea secundaria a una línea
 * (dropdown de la campanita); en la página /notifications se muestra completa.
 * Si se pasa `onDismiss`, aparece una ✕ para "marcar leído y que se vaya".
 * Si se pasa `onMarkRead` y la fila está no-leída, aparece un ✓ para marcarla
 * como leída (quita el resalte) sin quitarla de la lista.
 */
export function NotificationItemRow({
  it,
  unread,
  truncate = false,
  onNavigate,
  onDismiss,
  onMarkRead,
  pending = false,
  onUndo,
}: {
  it: NotifItem;
  unread: boolean;
  truncate?: boolean;
  onNavigate?: () => void;
  onDismiss?: (id: string) => void;
  /** Marca esta sola como leída sin quitarla (solo se muestra si está no-leída). */
  onMarkRead?: (id: string) => void;
  /** En ventana de "Deshacer": se muestra la tira en vez del contenido. */
  pending?: boolean;
  onUndo?: (id: string) => void;
}) {
  const sub = notifSubtitle(it);
  // El ✓ solo tiene sentido cuando la fila está no-leída.
  const showMarkRead = unread && !!onMarkRead;
  // Las apuestas pintan cada desenlace distinto (ganada/perdida/empate/premio).
  const betMeta = it.type === "bet" ? BET_META[betResultOf(it)] : null;
  const icon = betMeta?.icon ?? NOTIF_ICON[it.type];
  const dot = betMeta?.dot ?? NOTIF_DOT[it.type];
  const betAmount =
    betMeta && (betMeta === BET_META.won || betMeta === BET_META.claimable) && it.amountSats
      ? it.amountSats
      : null;

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
          style={{ background: dot }}
        />
      ) : null}
      <Link
        href={it.href}
        onClick={onNavigate}
        className={cn(
          "flex gap-2.5 py-3 pl-3.5 transition-colors hover:bg-white/5",
          showMarkRead ? "pr-[3.75rem]" : "pr-9",
        )}
      >
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]"
          style={{
            background: `color-mix(in srgb, ${dot} 18%, transparent)`,
            ...(betMeta === BET_META.lost ? { color: dot, fontWeight: 700 } : null),
          }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 text-[13px] font-medium leading-snug text-ln-text",
                truncate && "truncate",
              )}
            >
              {notifTitle(it)}
            </span>
            {betAmount ? (
              <span
                className="shrink-0 rounded-full px-1.5 py-px text-[11px] font-bold"
                style={{
                  color: dot,
                  background: `color-mix(in srgb, ${dot} 14%, transparent)`,
                }}
              >
                +{satsLabel(betAmount)} sats
              </span>
            ) : null}
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
      {showMarkRead ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead(it.id);
          }}
          aria-label="Marcar como leída"
          title="Marcar como leída"
          className="absolute right-8 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ln-faint transition-colors hover:bg-white/10 hover:text-ln-luna"
        >
          ✓
        </button>
      ) : null}
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
