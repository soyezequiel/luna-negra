"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { Button } from "@/components/ui/button";
import { Lud16Form } from "@/components/lud16-form";
import { NostrProfileForm } from "@/components/nostr-profile-form";
import { NostrPermsSection } from "@/components/nostr-perms-section";
import { fetchProfile, type NostrProfile } from "@/lib/nostr";
import { satsLabel } from "@/lib/format";

export default function EditProfilePage() {
  const { user, login, loading } = useSession();
  const [profile, setProfile] = useState<NostrProfile | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchProfile(user.pubkey).then(setProfile).catch(() => {});
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-[22px] py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold text-white">
          Editar perfil
        </h1>
        <p className="mt-2 text-ln-muted">Conectá tu Nostr para configurar tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="luna" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] px-[22px] py-8 pb-12">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight text-white">
          Editar perfil
        </h1>
        <Link href="/profile" className="btn btn-ghost px-4 py-2 text-sm">
          ← Volver al perfil
        </Link>
      </div>

      <div className="mt-6 space-y-6">
        <NostrProfileForm profile={profile} />
        {user.custodial ? <CustodialKeySection /> : null}
        <NwcSection />
        <PayoutDestinationSection nostrLud16={profile?.lud16 ?? null} />
        <BetaGamesSection />
        <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
          <h2 className="text-[15px] font-semibold text-ln-text">Permisos Nostr</h2>
          <div className="mt-3">
            <NostrPermsSection />
          </div>
        </section>
      </div>
    </div>
  );
}

// Cuentas custodiales (login por email): mostramos y dejamos copiar la nsec que
// Luna Negra custodia, para que el usuario pueda llevarse su identidad Nostr a
// cualquier cliente cuando quiera. La clave se pide on-demand al backend.
function CustodialKeySection() {
  const [nsec, setNsec] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/nsec");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo obtener la clave");
      setNsec(data.nsec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al obtener la clave");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!nsec) return;
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard bloqueado: el usuario puede seleccionar el texto */
    }
  }

  return (
    <section className="rounded-ln-lg border border-ln-corona/30 bg-ln-card/60 p-5">
      <h2 className="text-[15px] font-semibold text-ln-text">Tu clave Nostr (nsec)</h2>
      <p className="mt-1 text-sm text-ln-muted">
        Tu cuenta se creó con email, así que generamos una identidad Nostr por vos.
        Esta es tu clave privada: guardala en un lugar seguro y podés usarla para
        entrar desde cualquier cliente Nostr.
      </p>
      <p className="mt-2 text-[12.5px] text-ln-corona-bright">
        ⚠ Nunca la compartas. Quien tenga tu nsec controla tu cuenta por completo.
      </p>

      {nsec ? (
        <div className="mt-4">
          <div className="break-all rounded-ln-md border border-ln-border bg-ln-bg-deep p-3 font-mono text-xs text-ln-text">
            {nsec}
          </div>
          <Button variant="ghost" className="mt-3" onClick={copy}>
            {copied ? "Copiado ✓" : "Copiar"}
          </Button>
        </div>
      ) : (
        <Button variant="corona" className="mt-4" onClick={reveal} disabled={loading}>
          {loading ? "Cargando…" : "Mostrar mi clave"}
        </Button>
      )}

      {error ? <p className="mt-2 text-sm text-ln-danger">{error}</p> : null}
    </section>
  );
}

function NwcSection() {
  const { connected, balanceSats, loading, connect, disconnect, refresh } =
    useWallet();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await connect(value.trim());
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar el wallet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-ln-lg border border-ln-corona/30 bg-ln-card/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ln-text">Wallet Lightning (NWC)</h2>
        {connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ln-corona/15 px-2.5 py-1 font-mono text-[12px] font-semibold text-ln-corona-bright">
            ⚡ {loading ? "…" : balanceSats != null ? `${satsLabel(balanceSats)} sats` : "sin saldo"}
          </span>
        ) : null}
      </div>

      {connected ? (
        <div className="mt-3">
          <p className="text-sm text-ln-muted">
            Wallet conectado en este navegador. Podés pagar compras y apuestas con tu
            saldo, y cobrar premios directo a tu wallet.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Actualizando…" : "Actualizar saldo"}
            </Button>
            <Button variant="ghost" onClick={disconnect}>
              Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onConnect} className="mt-3">
          <p className="text-sm text-ln-muted">
            Pegá tu string de conexión NWC (Alby, Mutiny, etc.). El secreto se guarda
            <span className="font-medium text-ln-soft"> sólo en este navegador</span> y
            nunca se manda al servidor.
          </p>
          <input
            type="password"
            autoComplete="off"
            placeholder="nostr+walletconnect://…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="mt-3 w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 font-mono text-xs text-ln-text placeholder:text-ln-faint focus:outline-none focus:ring-2 focus:ring-ln-corona/40"
          />
          <Button
            variant="corona"
            type="submit"
            className="mt-3"
            disabled={busy || !value.trim()}
          >
            {busy ? "Conectando…" : "Conectar wallet"}
          </Button>
          {error ? <p className="mt-2 text-sm text-ln-danger">{error}</p> : null}
        </form>
      )}
    </section>
  );
}

function PayoutDestinationSection({ nostrLud16 }: { nostrLud16: string | null }) {
  const { user, updateUser } = useSession();
  const { connected } = useWallet();
  const method = user?.payoutMethod === "nwc" ? "nwc" : "address";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setMethod(next: "address" | "nwc") {
    if (next === method) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutMethod: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      updateUser({ payoutMethod: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <h2 className="text-[15px] font-semibold text-ln-text">Destino de cobros</h2>
      <p className="mt-1 text-sm text-ln-muted">
        Elegí dónde recibís los premios de tus apuestas.
      </p>

      <div className="mt-4 space-y-2">
        <RadioRow
          checked={method === "address"}
          disabled={saving}
          onSelect={() => setMethod("address")}
          title="Dirección Lightning"
          desc="Te pagamos directo a tu Lightning Address (funciona aunque estés offline)."
        />
        <RadioRow
          checked={method === "nwc"}
          disabled={saving}
          onSelect={() => setMethod("nwc")}
          title="Mi wallet NWC"
          desc="Cobrás los premios a tu wallet conectado. Tenés que reclamarlos con la app abierta."
        />
      </div>

      {error ? <p className="mt-2 text-sm text-ln-danger">{error}</p> : null}

      {method === "address" ? (
        <div className="mt-5 border-t border-ln-border pt-4">
          <h3 className="text-[13px] font-semibold text-ln-soft">Lightning Address</h3>
          <div className="mt-2">
            <Lud16Form nostrLud16={nostrLud16} />
          </div>
        </div>
      ) : (
        <div className="mt-5 border-t border-ln-border pt-4">
          {connected ? (
            <p className="text-sm text-ln-muted">
              Cuando ganes una apuesta, vas a ver el botón “Cobrar con saldo (NWC)” en la
              página de la apuesta. Tenés 60 minutos para reclamar el premio.
            </p>
          ) : (
            <p className="text-sm text-ln-corona-bright">
              Conectá un wallet NWC arriba para poder cobrar tus premios con esta opción.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// Opt-in para ver juegos en beta. Por defecto los juegos marcados beta no
// aparecen en la tienda ni en su ficha; al activar esto el usuario los ve y
// puede probarlos (la preferencia se guarda en `User.showBetaGames`).
function BetaGamesSection() {
  const { user, updateUser } = useSession();
  const enabled = Boolean(user?.showBetaGames);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showBetaGames: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      updateUser({ showBetaGames: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <h2 className="text-[15px] font-semibold text-ln-text">Juegos en beta</h2>
      <p className="mt-1 text-sm text-ln-muted">
        Mostrá en la tienda los juegos marcados como beta. Son juegos todavía en
        prueba: pueden tener errores o cambiar. Por defecto están ocultos.
      </p>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className={`mt-4 flex w-full items-center justify-between gap-3 rounded-ln-md border p-3 text-left transition-colors ${
          enabled
            ? "border-ln-luna/60 bg-ln-luna/10"
            : "border-ln-border bg-ln-bg-deep/40 hover:border-ln-border-strong"
        } ${saving ? "opacity-60" : ""}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ln-text">
            Ver juegos beta
          </span>
          <span className="mt-0.5 block text-[12.5px] text-ln-muted">
            {enabled ? "Activado" : "Desactivado"}
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-ln-luna" : "bg-ln-border"
          }`}
          aria-hidden
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
      {error ? <p className="mt-2 text-sm text-ln-danger">{error}</p> : null}
    </section>
  );
}

function RadioRow({
  checked,
  disabled,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-ln-md border p-3 text-left transition-colors ${
        checked
          ? "border-ln-corona/60 bg-ln-corona/10"
          : "border-ln-border bg-ln-bg-deep/40 hover:border-ln-border-strong"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-ln-corona" : "border-ln-muted"
        }`}
        aria-hidden
      >
        {checked ? <span className="h-2 w-2 rounded-full bg-ln-corona" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ln-text">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-ln-muted">{desc}</span>
      </span>
    </button>
  );
}
