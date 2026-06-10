"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { fetchProfile, profileName, type NostrProfile } from "@/lib/nostr";
import { Button } from "@/components/ui/button";
import { satsLabel, hueFromSlug } from "@/lib/format";
import { ACTIVE_BET_STATUSES } from "@/lib/bet-ui";

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
      className="rounded border border-line bg-panel p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
        {label}
      </p>
      <p className="mt-1 text-[25px] font-bold leading-none text-ink">{value}</p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p> : null}
    </div>
  );
}

export default function ProfilePage() {
  const { user, login, loading } = useSession();
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
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Perfil</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const name = profileName(profile) ?? "Anónimo";
  const vitrina = games.slice(0, 3);
  const recentSettled = bets.filter((b) => b.status === "settled").slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12">
      {/* Banner (degradado por npub) + avatar */}
      <div
        className="cover relative mt-4 h-[172px] overflow-hidden rounded-lg border border-line"
        style={{ "--h": hueFromSlug(user.npub) } as CSSProperties}
      />
      <div className="-mt-[52px] flex flex-col items-start gap-3 px-2 sm:flex-row sm:items-end">
        {profile?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.picture}
            alt=""
            className="rounded-[14px] border-4 border-bg object-cover"
            style={{ height: 104, width: 104 }}
          />
        ) : (
          <div
            className="rounded-[14px] border-4 border-bg bg-panel-3"
            style={{ height: 104, width: 104 }}
          />
        )}
        <div className="min-w-0 pb-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{name}</h1>
            {/* TODO dato real: el nivel no tiene fuente todavía. */}
            <span className="rounded-sm bg-blue/15 px-2 py-0.5 text-xs font-semibold text-blue ring-1 ring-inset ring-blue/30">
              Nivel 1
            </span>
          </div>
          <p className="break-all font-mono text-xs text-faint">{user.npub}</p>
        </div>
        <a
          href={`https://njump.me/${user.npub}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost ml-auto px-3 py-1.5 text-xs"
        >
          Ver en njump.me ↗
        </a>
      </div>

      {profile?.about ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted">
          {profile.about}
        </p>
      ) : null}

      {/* KPIs (datos reales: escrow, apuestas, biblioteca) */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="En escrow"
          value={satsLabel(stats.escrowSats)}
          sub="sats en juego"
          accent="var(--btc)"
        />
        <Kpi
          label="Ganadas"
          value={`${stats.won} / ${stats.settledTotal}`}
          sub={`${stats.winRate}% win rate`}
          accent="var(--win)"
        />
        <Kpi
          label="Neto"
          value={`${stats.netSats >= 0 ? "+" : ""}${satsLabel(stats.netSats)}`}
          sub="sats (aprox. 1v1)"
          accent="var(--win)"
        />
        <Kpi
          label="Biblioteca"
          value={String(games.length)}
          sub="juegos"
          accent="var(--blue)"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:[grid-template-columns:minmax(0,1fr)_320px]">
        {/* Izquierda: vitrina + actividad */}
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Vitrina</h2>
            {vitrina.length === 0 ? (
              <p className="text-sm text-faint">
                Tu biblioteca está vacía.{" "}
                <Link href="/" className="text-blue hover:underline">
                  Ir a la tienda
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {vitrina.map((g) => (
                  <Link key={g.id} href={`/game/${g.slug}`} className="group">
                    <div
                      className="cover relative aspect-[16/10] overflow-hidden rounded border border-line transition-all group-hover:ring-1 group-hover:ring-blue/40"
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
                    <p className="mt-1.5 truncate text-xs text-ink">{g.title}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">
              Actividad reciente
            </h2>
            {recentSettled.length === 0 ? (
              <p className="text-sm text-faint">Sin actividad todavía.</p>
            ) : (
              <ul className="space-y-2">
                {recentSettled.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded border border-line bg-panel px-4 py-2.5 text-sm"
                  >
                    <span className="text-ink">
                      {b.result === "won" ? (
                        <span className="text-green">Ganó</span>
                      ) : b.result === "lost" ? (
                        <span className="text-muted">Perdió</span>
                      ) : (
                        <span className="text-blue">Empató</span>
                      )}{" "}
                      en {b.gameTitle}
                    </span>
                    <span className="font-mono text-xs text-btc">
                      {satsLabel(b.stakeSats)} sats
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Derecha: insignias + Lightning Address */}
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Insignias</h2>
            {/* Decorativas (sin fuente real todavía). */}
            <div className="grid grid-cols-3 gap-2">
              {["🎮", "⚡", "🏆"].map((b, i) => (
                <div
                  key={i}
                  className="flex aspect-square items-center justify-center rounded border border-line bg-panel text-2xl"
                  title="Insignia"
                >
                  {b}
                </div>
              ))}
            </div>
          </section>

          <Lud16Form nostrLud16={profile?.lud16 ?? null} />
        </div>
      </div>
    </div>
  );
}

function Lud16Form({ nostrLud16 }: { nostrLud16: string | null }) {
  const { user, updateUser } = useSession();
  const [value, setValue] = useState(user?.lud16 ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Sincroniza con el valor de la sesión cuando carga.
  useEffect(() => {
    setValue(user?.lud16 ?? "");
  }, [user?.lud16]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    const trimmed = value.trim();
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lud16: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      // Refleja el valor normalizado (minúsculas, o null si quedó vacío) en la
      // sesión, para que el contexto no quede desincronizado con la DB.
      updateUser({ lud16: trimmed ? trimmed.toLowerCase() : null });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error al guardar");
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-[15px] font-semibold text-ink">
        Lightning Address (cobros)
      </h2>
      <p className="mt-1 text-sm text-muted">
        Dirección donde recibís tus pagos y premios. Si la dejás vacía, usamos la
        de tu perfil Nostr
        {nostrLud16 ? (
          <>
            {" "}
            (<span className="font-mono text-ink">{nostrLud16}</span>)
          </>
        ) : null}
        ; si tampoco hay, vas a cobrar escaneando un QR.
      </p>

      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="usuario@dominio.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus("idle");
          }}
          className="w-full rounded-sm border border-line bg-black/20 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-btc/40"
        />
        <Button variant="btc" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Guardando…" : "Guardar"}
        </Button>
      </form>

      {status === "saved" ? (
        <p className="mt-2 text-sm text-green">Guardado ✓</p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
      ) : null}
    </section>
  );
}
