"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useFriends } from "@/hooks/use-friends";
import { fetchProfile, profileName, type NostrProfile } from "@/lib/nostr";
import { Button } from "@/components/ui/button";
import { satsLabel, hueFromSlug } from "@/lib/format";
import { normalizeImageUrl } from "@/lib/game-media";
import { NostrPermsSection } from "@/components/nostr-perms-section";
import { BalAuthorizationsSection } from "@/components/bal-authorizations-section";
import { useAppMode } from "@/providers/app-mode-provider";

type LibGame = { id: string; slug: string; title: string; coverUrl: string | null };
type MineBet = {
  id: string;
  version: 1 | 2;
  gameSlug: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  result: string;
  payoutStatus: string;
  payoutSats: number | null;
  payoutDestination: string | null;
  payoutKind: string | null;
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
  const { user, login, logout, loading } = useSession();
  const { notify } = useNotify();
  const { friends } = useFriends();
  const { connected: nwcConnected, balanceSats } = useWallet();
  const { mode } = useAppMode();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [games, setGames] = useState<LibGame[]>([]);
  const [bets, setBets] = useState<MineBet[]>([]);
  const [npubCopied, setNpubCopied] = useState(false);
  const [friendCodeCopied, setFriendCodeCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchProfile(user.pubkey).then(setProfile);
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setGames(d.games ?? []))
      .catch(() => {});
    fetch("/api/me/bets")
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => {});
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-[22px] py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold text-white">
          Perfil
        </h1>
        <p className="mt-2 text-ln-muted">Iniciá sesión para ver tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="luna" onClick={login}>
            Iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  // Mostramos de inmediato el nombre/foto cacheados en la sesión (vienen de la
  // DB con /api/auth/me, instantáneo) y los refinamos cuando `fetchProfile`
  // termina de consultar los relays (lento). Antes solo se pintaba al resolver
  // el relay, así que el header quedaba en "Anónimo" sin foto varios segundos.
  const name = profileName(profile) ?? user.displayName ?? "Anónimo";
  const avatarUrl = profile?.picture ?? user.avatarUrl ?? null;
  const settledBets = bets.filter((b) => b.status === "settled");
  const recentSettled = settledBets.slice(0, 3);
  const wonCount = settledBets.filter((b) => b.result === "won").length;
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

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(user!.npub);
      setNpubCopied(true);
      notify({ title: "npub copiada" });
      window.setTimeout(() => setNpubCopied(false), 1500);
    } catch {
      notify({ title: "No se pudo copiar la npub" });
    }
  }

  async function copyFriendCode() {
    if (user!.friendCode == null) return;
    try {
      await navigator.clipboard.writeText(String(user!.friendCode));
      setFriendCodeCopied(true);
      notify({ title: "Código de amistad copiado" });
      window.setTimeout(() => setFriendCodeCopied(false), 1500);
    } catch {
      notify({ title: "No se pudo copiar el código" });
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
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
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
              <button
                type="button"
                onClick={copyNpub}
                title="Copiar npub completa"
                aria-label="Copiar npub completa"
                className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-ln-border bg-ln-bg-deep/60 px-2.5 py-1 font-mono text-[11px] text-ln-muted transition-colors hover:border-ln-luna hover:text-ln-soft"
              >
                ⬡ {user.npub.slice(0, 18)}…
                <span className="not-italic">{npubCopied ? "✓" : "⧉"}</span>
              </button>
              {user.friendCode != null ? (
                <button
                  type="button"
                  onClick={copyFriendCode}
                  title="Copiar código de amistad"
                  className="inline-flex items-center gap-1.5 rounded-full border border-ln-luna/35 bg-ln-luna/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-ln-luna-bright transition-colors hover:bg-ln-luna/15"
                >
                  Código #{user.friendCode}
                  <span aria-hidden>{friendCodeCopied ? "✓" : "⧉"}</span>
                </button>
              ) : null}
              {user.lud16 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-corona/15 px-2.5 py-1 text-[11px] font-medium text-ln-corona">
                  ⚡ {user.lud16}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-aurora/15 px-2.5 py-1 text-[11px] font-medium text-ln-aurora">
                {wonCount} victorias
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
            {/* Cierre de sesión accesible en móvil (en escritorio vive en el navbar) */}
            <button
              onClick={logout}
              className="btn btn-ghost px-4 py-2 text-sm ln:hidden"
            >
              Salir
            </button>
          </div>
        </div>
      </section>

      {/* Stats (datos reales). Las métricas de apuestas (victorias, escrow) viven
          en /bets para no duplicar; acá solo lo propio del perfil. */}
      <div className="mt-6 grid grid-cols-2 gap-3">
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-semibold text-ln-text">
                Apuestas recientes
              </h2>
              <Link
                href="/bets"
                className="text-[13px] font-medium text-ln-luna hover:underline"
              >
                Ver todas →
              </Link>
            </div>
            {recentSettled.length === 0 ? (
              <p className="text-sm text-ln-faint">
                Sin apuestas todavía.{" "}
                <Link href="/bets" className="text-ln-luna hover:underline">
                  Ir a tus apuestas
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {recentSettled.map((b) => {
                  const href = b.version === 2 ? `/apuestas/${b.id}` : `/bets/${b.id}`;
                  // Solo mostramos "llegó a" si cobró y hay destino real (ganó/empató).
                  // `lnurl-withdraw` es el placeholder del cobro por QR de v1, no una wallet.
                  const showDest =
                    b.payoutStatus === "paid" &&
                    !!b.payoutDestination &&
                    b.payoutDestination !== "lnurl-withdraw";
                  return (
                    <li
                      key={`${b.version}:${b.id}`}
                      className="rounded-ln-md border border-ln-border bg-ln-card/60 px-4 py-2.5 text-sm"
                    >
                      <Link href={href} className="flex items-center justify-between gap-3">
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
                      </Link>
                      {showDest ? (
                        <p className="mt-1 text-[11.5px] text-ln-faint">
                          💸 Premio a{" "}
                          <span className="font-mono text-ln-muted">
                            {b.payoutDestination}
                          </span>
                          {b.payoutKind === "zap" ? (
                            <span> · zap NIP-57</span>
                          ) : b.payoutKind === "lnurl" ? (
                            <span> · LNURL (sin recibo Nostr)</span>
                          ) : null}
                        </p>
                      ) : b.payoutStatus === "claimed" ? (
                        <p className="mt-1 text-[11.5px] text-ln-faint">
                          🎟️ Premio cobrado por QR (retiro)
                        </p>
                      ) : b.payoutStatus === "withdraw_pending" ? (
                        <p className="mt-1 text-[11.5px] text-ln-faint">
                          🎟️ Premio pendiente de retiro por QR
                        </p>
                      ) : null}
                    </li>
                  );
                })}
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
                          src={normalizeImageUrl(g.coverUrl)}
                          alt={g.title}
                          referrerPolicy="no-referrer"
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
          {mode === "bal" ? (
            <BalAuthorizationsSection />
          ) : (
            <section className="rounded-ln-lg border border-ln-corona/30 bg-ln-corona/[0.06] p-4">
              <p className="ln-label text-ln-corona">Modo independiente</p>
              <h2 className="mt-1 text-sm font-semibold text-ln-text">
                Los juegos gestionan su acceso
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-ln-muted">
                Luna Negra no iniciará sesiones BAL ni compartirá permisos con el juego.
                Cada juego puede pedirte su propio inicio de sesión.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
