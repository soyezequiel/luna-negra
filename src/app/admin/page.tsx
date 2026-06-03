"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  provider: { name: string };
};

export default function AdminPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<Row[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/games");
    if (r.status === 403) {
      setForbidden(true);
      setGames([]);
      return;
    }
    const d = await r.json();
    setForbidden(false);
    setGames(d.games ?? []);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function approve(id: string) {
    await fetch(`/api/admin/games/${id}/approve`, { method: "POST" });
    load();
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Admin</h1>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-zinc-400">
        No estás autorizado para ver esta página.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Revisión de juegos</h1>
      {games === null ? (
        <p className="mt-2 text-sm text-zinc-500">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-2 text-zinc-400">No hay juegos en revisión.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {games.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{g.title}</p>
                <p className="text-xs text-zinc-500">
                  {g.provider.name} ·{" "}
                  {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                </p>
              </div>
              <Button onClick={() => approve(g.id)}>Aprobar y publicar</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
