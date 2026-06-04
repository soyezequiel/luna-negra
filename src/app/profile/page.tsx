"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { fetchProfile, profileName, type NostrProfile } from "@/lib/nostr";
import { Button } from "@/components/ui/button";

export default function ProfilePage() {
  const { user, login, loading } = useSession();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingProfile(true);
    fetchProfile(user.pubkey)
      .then(setProfile)
      .finally(() => setLoadingProfile(false));
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Perfil</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para ver tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  const name = profileName(profile);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-4">
        {profile?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.picture}
            alt=""
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="h-20 w-20 rounded-full bg-white/10" />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{name ?? "Anónimo"}</h1>
          <p className="break-all font-mono text-xs text-zinc-500">{user.npub}</p>
        </div>
      </div>

      {profile?.about ? (
        <p className="mt-4 whitespace-pre-wrap text-zinc-300">{profile.about}</p>
      ) : null}
      {loadingProfile ? (
        <p className="mt-4 text-sm text-zinc-500">Cargando perfil desde Nostr…</p>
      ) : null}

      <Lud16Form nostrLud16={profile?.lud16 ?? null} />
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
    <section className="mt-10 rounded-lg border border-white/10 p-5">
      <h2 className="text-lg font-semibold">Lightning Address (cobros)</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Dirección donde recibís tus pagos y premios. Si la dejás vacía, usamos la
        de tu perfil Nostr
        {nostrLud16 ? (
          <>
            {" "}
            (<span className="font-mono text-zinc-300">{nostrLud16}</span>)
          </>
        ) : null}
        ; si tampoco hay, vas a cobrar escaneando un QR.
      </p>

      <form onSubmit={save} className="mt-4 flex flex-col gap-3 sm:flex-row">
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
          className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Guardando…" : "Guardar"}
        </Button>
      </form>

      {status === "saved" ? (
        <p className="mt-2 text-sm text-emerald-400">Guardado ✓</p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      ) : null}
    </section>
  );
}
