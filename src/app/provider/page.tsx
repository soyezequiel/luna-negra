"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

const inputCls =
  "w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50";

type Provider = {
  id: string;
  name: string;
  lightningAddress: string | null;
};
type Game = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  published: "Publicado",
};

export default function ProviderPage() {
  const { user, login, loading } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceSats, setPriceSats] = useState("0");
  const [gameUrl, setGameUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/provider")
      .then((r) => r.json())
      .catch(() => null);
    if (d?.provider) {
      setProvider(d.provider);
      setName(d.provider.name);
      setLn(d.provider.lightningAddress ?? "");
    }
    setGames(d?.games ?? []);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function saveProvider(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lightningAddress: ln }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setProvider(d.provider);
    setMsg("Perfil guardado.");
  }

  async function createGame(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/provider/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        priceSats: Number(priceSats),
        gameUrl,
        coverUrl,
      }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setTitle("");
    setDescription("");
    setPriceSats("0");
    setGameUrl("");
    setCoverUrl("");
    setMsg("Juego creado (borrador).");
    load();
  }

  async function submitGame(id: string) {
    await fetch(`/api/provider/games/${id}/submit`, { method: "POST" });
    load();
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Proveedor</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para publicar juegos.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Panel de proveedor</h1>
      {msg ? <p className="mt-2 text-sm text-sky-400">{msg}</p> : null}

      <form
        onSubmit={saveProvider}
        className="mt-6 space-y-3 rounded-xl border border-white/10 bg-white/5 p-5"
      >
        <h2 className="font-semibold">
          {provider ? "Tu perfil" : "Creá tu perfil de proveedor"}
        </h2>
        <input
          className={inputCls}
          placeholder="Nombre del estudio"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Lightning Address para el payout (ej. vos@getalby.com)"
          value={ln}
          onChange={(e) => setLn(e.target.value)}
        />
        <Button type="submit">{provider ? "Guardar" : "Crear perfil"}</Button>
      </form>

      {provider ? (
        <>
          <form
            onSubmit={createGame}
            className="mt-8 space-y-3 rounded-xl border border-white/10 bg-white/5 p-5"
          >
            <h2 className="font-semibold">Nuevo juego</h2>
            <input
              className={inputCls}
              placeholder="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className={inputCls}
              placeholder="Descripción"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-3">
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="Precio (sats)"
                value={priceSats}
                onChange={(e) => setPriceSats(e.target.value)}
              />
              <input
                className={inputCls}
                placeholder="URL del juego (subdominio)"
                value={gameUrl}
                onChange={(e) => setGameUrl(e.target.value)}
              />
            </div>
            <input
              className={inputCls}
              placeholder="URL de portada (opcional)"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
            />
            <Button type="submit">Crear borrador</Button>
          </form>

          <section className="mt-8">
            <h2 className="mb-3 font-semibold">Tus juegos</h2>
            {games.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no creaste juegos.</p>
            ) : (
              <ul className="space-y-2">
                {games.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{g.title}</p>
                      <p className="text-xs text-zinc-500">
                        {STATUS_LABEL[g.status] ?? g.status} ·{" "}
                        {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                      </p>
                    </div>
                    {g.status === "draft" ? (
                      <Button variant="outline" onClick={() => submitGame(g.id)}>
                        Enviar a revisión
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
