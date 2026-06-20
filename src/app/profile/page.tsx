"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useFriends } from "@/hooks/use-friends";
import { fetchProfile, profileName, type NostrProfile } from "@/lib/nostr";
import { Button } from "@/components/ui/button";
import { satsLabel, hueFromSlug } from "@/lib/format";
import { ACTIVE_BET_STATUSES } from "@/lib/bet-ui";
import { NostrPermsSection } from "@/components/nostr-perms-section";

type LibGame = { id: string; slug: string; title: string; coverUrl: string | null };
type MineBet = {
  id: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  result: string;
};

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="ln-label">{label}</p>
      <p className="mt-1 font-display text-[27px] font-extrabold leading-none text-ln-text">
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ln-muted">{sub}</p> : null}
    </div>
  );
}

export default function ProfilePage() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const { friends } = useFriends();
  const { connected: nwcConnected, balanceSats } = useWallet();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [games, setGames] = useState<LibGame[]>([]);
  const [bets, setBets] = useState<MineBet[]>([]);

  useEffect(() => {
    if (!user) return;
    fetchProfile(user.pubkey).then(setProfile);
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setGames(d.games ?? []))
      .catch(() => {});
    fetch("/api/escrow/bets/mine")
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => {});
  }, [user]);

  const stats = useMemo(() => {
    const settled = bets.filter((b) => b.status === "settled");
    const won = settled.filter((b) => b.result === "won").length;
    const escrowSats = bets
      .filter((b) => ACTIVE_BET_STATUSES.has(b.status))
      .reduce((s, b) => s + b.stakeSats, 0);
    const netSats = settled.reduce(
      (s, b) =>
        b.result === "won"
          ? s + b.stakeSats
          : b.result === "lost"
            ? s - b.stakeSats
            : s,
      0,
    );
    const winRate = settled.length
      ? Math.round((won / settled.length) * 100)
      : 0;
    return { won, settledTotal: settled.length, escrowSats, netSats, winRate };
  }, [bets]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-[22px] py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold text-white">
          Perfil
        </h1>
        <p className="mt-2 text-ln-muted">Conectá tu Nostr para ver tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="luna" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const name = profileName(profile) ?? "Anónimo";
  const recentSettled = bets.filter((b) => b.status === "settled").slice(0, 6);
  const friendCount = friends?.length ?? 0;

  async function share() {
    const url = `https://njump.me/${user!.npub}`;
    try {
      await navigator.clipboard.writeText(url);
      notify({ title: "Link de perfil copiado" });
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-8 pb-12">
      {/* Cabecera */}
      <section
        className="relative overflow-hidden rounded-ln-xl border border-ln-border p-6 ln:p-8"
        style={{
          background:
            "radial-gradient(900px 360px at 12% -40%, rgba(157,140,255,.22), transparent 60%), radial-gradient(700px 320px at 92% -20%, rgba(255,182,72,.14), transparent 62%), rgba(24,21,34,.6)",
        }}
      >
        <div className="flex flex-col items-start gap-5 ln:flex-row ln:items-center">
          {profile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.picture}
              alt=""
              className="h-24 w-24 shrink-0 rounded-full border-2 border-ln-luna object-cover shadow-ln-luna"
            />
          ) : (
            <span
              className="av-gen flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-ln-luna font-display text-3xl font-bold text-white shadow-ln-luna"
              style={{ "--h": hueFromSlug(user.npub) } as CSSProperties}
            >
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
              {name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-ln-border bg-ln-bg-deep/60 px-2.5 py-1 font-mono text-[11px] text-ln-muted">
                ⬡ {user.npub.slice(0, 18)}…
              </span>
              {user.lud16 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-corona/15 px-2.5 py-1 text-[11px] font-medium text-ln-corona">
                  ⚡ {user.lud16}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-aurora/15 px-2.5 py-1 text-[11px] font-medium text-ln-aurora">
                {stats.won} victorias
              </span>
              {nwcConnected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-corona/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-ln-corona-bright">
                  ⚡ {balanceSats != null ? `${satsLabel(balanceSats)} sats` : "wallet"}
                </span>
              ) : null}
            </div>
            {profile?.about ? (
              <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-ln-soft">
                {profile.about}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/profile/editar" className="btn btn-luna px-4 py-2 text-sm">
              Editar perfil
            </Link>
            <button onClick={share} className="btn btn-ghost px-4 py-2 text-sm">
              Compartir
            </button>
            <a
              href={`https://njump.me/${user.npub}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost px-4 py-2 text-sm"
            >
              Ver en Nostr ↗
            </a>
          </div>
        </div>
      </section>

      {/* Stats (datos reales) */}
      <div className="mt-6 grid grid-cols-2 gap-3 ln:grid-cols-4">
        <Kpi
          label="Victorias"
          value={`${stats.won} / ${stats.settledTotal}`}
          sub={`${stats.winRate}% efectividad`}
          accent="var(--ln-aurora)"
        />
        <Kpi
          label="En escrow"
          value={satsLabel(stats.escrowSats)}
          sub="sats en juego"
          accent="var(--ln-corona)"
        />
        <Kpi
          label="Juegos"
          value={String(games.length)}
          sub="en tu biblioteca"
          accent="var(--ln-luna)"
        />
        <Kpi
          label="Amigos"
          value={String(friendCount)}
          sub="en Nostr"
          accent="var(--ln-aurora)"
        />
      </div>

      <div className="mt-8 grid gap-6 ln:[grid-template-columns:minmax(0,1fr)_340px]">
        {/* Izquierda: actividad reciente */}
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-3 text-[17px] font-semibold text-ln-text">
              Actividad reciente
            </h2>
            {recentSettled.length === 0 ? (
              <p className="text-sm text-ln-faint">Sin actividad todavía.</p>
            ) : (
              <ul className="space-y-2">
                {recentSettled.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded-ln-md border border-ln-border bg-ln-card/60 px-4 py-2.5 text-sm"
                  >
                    <span className="text-ln-text">
                      {b.result === "won" ? (
                        <span className="font-medium text-ln-aurora">Ganaste</span>
                      ) : b.result === "lost" ? (
                        <span className="text-ln-muted">Perdiste</span>
                      ) : (
                        <span className="text-ln-luna">Empate</span>
                      )}{" "}
                      en {b.gameTitle}
                    </span>
                    <span className="font-mono text-xs text-ln-corona-bright">
                      {satsLabel(b.stakeSats)} sats
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Tu biblioteca */}
            <h2 className="mb-3 mt-8 text-[17px] font-semibold text-ln-text">
              Tu biblioteca
            </h2>
            {games.length === 0 ? (
              <p className="text-sm text-ln-faint">
                Tu biblioteca está vacía.{" "}
                <Link href="/" className="text-ln-luna hover:underline">
                  Ir a la tienda
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 ln:grid-cols-4">
                {games.slice(0, 8).map((g) => (
                  <Link key={g.id} href={`/game/${g.slug}`} className="group">
                    <div
                      className="cover relative aspect-[3/4] overflow-hidden rounded-ln-md border border-ln-border transition-[transform,border-color] group-hover:-translate-y-[3px] group-hover:border-ln-luna/40"
                      style={{ "--h": hueFromSlug(g.slug) } as CSSProperties}
                    >
                      {g.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.coverUrl}
                          alt={g.title}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs font-semibold text-white/90">
                          {g.title}
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs text-ln-text">
                      {g.title}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Derecha: permisos Nostr (la config de cobros vive en /profile/editar) */}
        <div className="space-y-6">
          <NostrPermsSection />
        </div>
      </div>
    </div>
  );
}
