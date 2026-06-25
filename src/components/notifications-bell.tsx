"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useNotificationsCenter } from "@/hooks/use-notifications-center";
import { NotificationItemRow } from "@/components/notification-item";

export function NotificationsBell() {
  const { user } = useSession();
  const { items, unreadCount, seenAt, markAllSeen } = useNotificationsCenter();
  const [open, setOpen] = useState(false);
  // Foto de la marca "visto hasta" al abrir: markAllSeen la avanza enseguida, así
  // que la guardamos para seguir resaltando lo que ERA nuevo mientras está abierto.
  const [seenSnapshot, setSeenSnapshot] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al click afuera / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setSeenSnapshot(seenAt ?? 0); // congela el "antes" para resaltar lo nuevo
      markAllSeen(); // abrir = leído
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notificaciones"
        title="Notificaciones"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ln-soft transition-colors hover:bg-white/5 hover:text-white"
      >
        <span aria-hidden className="text-[17px]">
          🔔
        </span>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-ln-corona px-1 text-[10px] font-bold text-ln-on-corona ring-2 ring-ln-bg">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-ln-lg border border-ln-border-strong bg-ln-card shadow-ln-modal">
          <div className="flex items-center justify-between border-b border-ln-border px-3.5 py-2.5">
            <span className="text-sm font-semibold text-ln-text">Notificaciones</span>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-ln-muted hover:text-white"
            >
              Ver todas
            </Link>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items === null ? (
              <p className="px-3.5 py-6 text-center text-xs text-ln-faint">
                Cargando…
              </p>
            ) : items.length === 0 ? (
              <div className="px-3.5 py-8 text-center">
                <p className="text-sm font-medium text-ln-text">
                  No tenés notificaciones nuevas
                </p>
                <p className="mt-1 text-xs text-ln-muted">
                  Acá vas a ver compras, zaps, reseñas y comentarios de tus juegos.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-ln-border/60">
                {items.slice(0, 12).map((it) => (
                  <li key={it.id}>
                    <NotificationItemRow
                      it={it}
                      unread={it.at > (seenSnapshot ?? 0)}
                      truncate
                      onNavigate={() => setOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
