"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  getNostrPermsMode,
  setNostrPermsMode,
  warmUpPermissions,
  type NostrPermsMode,
} from "@/lib/nostr-social";
import { getActiveSigner } from "@/lib/signer";

/**
 * Ajuste del modo de permisos NIP-07 (nos2x/Alby).
 * - "lazy" (default): cada función pide su permiso recién al usarse; en el
 *   prompt de la extensión el usuario decide si lo recuerda o no.
 * - "all": al iniciar sesión se piden todos los permisos de una vez.
 */
export function NostrPermsSection() {
  const { user } = useSession();
  const [mode, setMode] = useState<NostrPermsMode>("lazy");
  const [warming, setWarming] = useState(false);
  const [warmed, setWarmed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [, startSyncTransition] = useTransition();

  // El modo vive en localStorage: leerlo recién al montar (evita SSR mismatch).
  // Solo aplica al login por extensión: con clave local no hay prompts y con
  // NIP-46 los permisos los gestiona el firmante remoto.
  useEffect(() => {
    startSyncTransition(() => {
      setMode(getNostrPermsMode());
      const method = getActiveSigner()?.method;
      setVisible(
        Boolean(window.nostr) && (method === undefined || method === "nip07"),
      );
    });
  }, [startSyncTransition]);

  if (!visible) return null;

  function choose(next: NostrPermsMode) {
    setMode(next);
    setNostrPermsMode(next);
  }

  async function warmNow() {
    if (!user || warming) return;
    setWarming(true);
    try {
      await warmUpPermissions(user.pubkey);
      setWarmed(true);
    } finally {
      setWarming(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-[15px] font-semibold text-ink">Permisos Nostr</h2>
      <p className="mt-1 text-sm text-muted">
        Elegí cuándo le pide Luna Negra permisos a tu extensión (nos2x, Alby).
      </p>

      <div className="mt-4 space-y-2">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="radio"
            name="nostr-perms"
            checked={mode === "lazy"}
            onChange={() => choose("lazy")}
            className="mt-0.5 accent-[var(--blue)]"
          />
          <span className="text-sm">
            <span className="text-ink">Pedir permisos cuando los necesite</span>
            <span className="block text-xs text-faint">
              Cada función pide el suyo al usarla (comentar, chat, presencia).
              En cada aviso de tu extensión decidís si lo recordás para siempre
              o no.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="radio"
            name="nostr-perms"
            checked={mode === "all"}
            onChange={() => choose("all")}
            className="mt-0.5 accent-[var(--blue)]"
          />
          <span className="text-sm">
            <span className="text-ink">Autorizar todo al iniciar sesión</span>
            <span className="block text-xs text-faint">
              Al conectar se piden todos los permisos juntos, una sola vez. En
              nos2x los avisos son por tipo de evento; en Alby, por operación.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="ghost" onClick={warmNow} disabled={warming || !user}>
          {warming ? "Pidiendo permisos…" : "Autorizar todo ahora"}
        </Button>
        {warmed && !warming ? (
          <span className="text-sm text-green">Listo ✓</span>
        ) : null}
      </div>
    </section>
  );
}
