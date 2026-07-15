"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { useNotificationsCenter } from "@/hooks/use-notifications-center";
import { NotificationItemRow } from "@/components/notification-item";
import { Button } from "@/components/ui/button";

export default function NotificationsPage() {
  const { user, login, loading } = useSession();
  const {
    items,
    refreshing,
    refresh,
    seenAt,
    markAllSeen,
    markSeenItem,
    readIds,
    dismiss,
    undoDismiss,
    pendingDismissals,
  } = useNotificationsCenter();
  // Foto de la marca al entrar, para resaltar lo que era nuevo antes de marcar leído.
  const [seenSnapshot, setSeenSnapshot] = useState<number | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    if (!user || marked.current) return;
    marked.current = true;
    setSeenSnapshot(seenAt ?? 0);
    markAllSeen();
  }, [user, seenAt, markAllSeen]);

  // "Marcar todo como leído": sube el snapshot a ahora (quita los resaltes) y
  // persiste la marca en el server.
  const markAllReadNow = () => {
    setSeenSnapshot(Date.now());
    markAllSeen();
  };
  const hasUnread =
    items?.some((it) => it.at > (seenSnapshot ?? 0) && !readIds.has(it.id)) ??
    false;

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-[22px] py-16 text-center">
        <h1 className="font-display text-[28px] font-extrabold text-white">
          Notificaciones
        </h1>
        <p className="mt-2 text-ln-muted">
          Iniciá sesión para ver la actividad de tus juegos.
        </p>
        <Button variant="luna" className="mt-4" onClick={login}>
          Iniciar sesión
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-[22px] py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight text-white">
          Notificaciones
        </h1>
        <div className="flex items-center gap-4">
          {hasUnread ? (
            <button
              onClick={markAllReadNow}
              className="text-sm text-ln-muted hover:text-white"
            >
              Marcar todo como leído
            </button>
          ) : null}
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Actualizar"
            className="text-sm text-ln-muted hover:text-white disabled:opacity-50"
          >
            <span className={refreshing ? "inline-block animate-spin" : undefined}>
              ↻
            </span>{" "}
            Actualizar
          </button>
        </div>
      </div>

      {items === null ? (
        <p className="text-sm text-ln-faint">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 px-5 py-12 text-center">
          <p className="text-base font-medium text-ln-text">
            Todavía no hay notificaciones
          </p>
          <p className="mt-1.5 text-sm text-ln-muted">
            Cuando alguien compre, zapee, reseñe o comente tus juegos —o se
            resuelva una apuesta tuya— va a aparecer acá.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ln-border/60 overflow-hidden rounded-ln-lg border border-ln-border bg-ln-card/60">
          {items.map((it) => (
            <li key={it.id}>
              <NotificationItemRow
                it={it}
                unread={it.at > (seenSnapshot ?? 0) && !readIds.has(it.id)}
                onDismiss={dismiss}
                onMarkRead={markSeenItem}
                pending={pendingDismissals.has(it.id)}
                onUndo={undoDismiss}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
