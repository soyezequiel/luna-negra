"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useFriends } from "@/hooks/use-friends";
import { profileName, shortId } from "@/lib/nostr-social";
import { parseInvite } from "@/lib/invite";
import { hueFromSlug } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";

/**
 * Riel "Tus amigos están jugando": fila scroll-x con los contactos que tienen
 * presencia NIP-38 activa (online / in-game). La presencia y los perfiles vienen
 * de useFriends (relays Nostr); si la presencia apunta a una sala de Luna Negra,
 * derivamos el juego de la invitación. No renderiza nada si nadie está online.
 */
export function SocialRail() {
  const { friends } = useFriends();
  const online = (friends ?? []).filter((f) => f.status);

  if (online.length === 0) return null;

  return (
    <section className="mb-9 animate-ln-rise">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ln-text">
          <span className="h-2 w-2 rounded-full bg-ln-aurora shadow-[0_0_8px_var(--ln-aurora)]" />
          Tus amigos están jugando
        </h2>
        <Link
          href="/friends"
          className="text-xs text-ln-muted transition-colors hover:text-ln-text"
        >
          Ver todos ›
        </Link>
      </div>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {online.map((f) => {
          const name = profileName(f.profile, shortId(f.npub));
          const invite = f.status?.url ? parseInvite(f.status.url) : null;
          const gameTitle = f.status?.content || invite?.slug || "En línea";
          const gameHue = hueFromSlug(invite?.slug ?? name);
          const card = (
            <div className="flex w-[182px] shrink-0 flex-col gap-2.5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-3 transition-[transform,border-color] duration-150 hover:-translate-y-[3px] hover:border-ln-aurora/50">
              <div className="flex items-center gap-2.5">
                <span className="relative shrink-0">
                  <Avatar
                    src={f.profile?.picture}
                    seed={name}
                    className="h-10 w-10"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ln-bg bg-ln-aurora" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ln-text">
                    {name}
                  </span>
                  <span className="block text-[11px] text-ln-aurora">
                    jugando ahora
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-1.5">
                <span
                  className="cover h-[26px] w-[26px] shrink-0 rounded-md"
                  style={{ "--h": gameHue } as CSSProperties}
                />
                <span className="min-w-0 truncate text-[11px] text-ln-soft">
                  {gameTitle}
                </span>
              </div>
            </div>
          );
          // Si hay sala unible, la card linkea al juego; si no, al perfil del amigo.
          return invite ? (
            <Link key={f.pubkey} href={`/game/${invite.slug}`}>
              {card}
            </Link>
          ) : (
            <div key={f.pubkey}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}
