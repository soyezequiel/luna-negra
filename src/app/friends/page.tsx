"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  fetchContacts,
  fetchProfiles,
  fetchStatuses,
  publishStatus,
  npubOf,
  profileName,
  shortId,
  type Profile,
  type Status,
} from "@/lib/nostr-social";

/** Si el estado del amigo apunta a una sala unible, devuelve el path relativo. */
function roomHref(status?: Status): string | null {
  if (!status?.url) return null;
  try {
    const u = new URL(status.url);
    if (!u.searchParams.get("room")) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

type Known = {
  pubkey: string;
  npub: string;
  displayName: string | null;
  games: { slug: string; title: string }[];
};

type Friend = {
  pubkey: string;
  npub: string;
  profile?: Profile;
  isMember: boolean;
  games: { slug: string; title: string }[];
  status?: Status;
};

export default function FriendsPage() {
  const { user, login, loading } = useSession();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [statusText, setStatusText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const contacts = await fetchContacts(user.pubkey);
    if (contacts.length === 0) {
      setFriends([]);
      return;
    }
    const [profiles, statuses, knownRes] = await Promise.all([
      fetchProfiles(contacts),
      fetchStatuses(contacts),
      fetch("/api/users/known", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkeys: contacts }),
      })
        .then((r) => r.json())
        .catch(() => ({ known: [] })),
    ]);

    const knownMap = new Map<string, Known>(
      (knownRes.known ?? []).map((k: Known) => [k.pubkey, k]),
    );

    const list: Friend[] = contacts.map((pk) => {
      const k = knownMap.get(pk);
      return {
        pubkey: pk,
        npub: npubOf(pk),
        profile: profiles[pk],
        isMember: Boolean(k),
        games: k?.games ?? [],
        status: statuses[pk],
      };
    });
    list.sort((a, b) => {
      if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
      return profileName(a.profile, a.npub).localeCompare(
        profileName(b.profile, b.npub),
      );
    });
    setFriends(list);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus() {
    if (!statusText.trim()) return;
    setStatusMsg(null);
    try {
      await publishStatus(statusText.trim());
      setStatusMsg("Estado publicado en Nostr.");
      setStatusText("");
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Amigos</h1>
        <p className="mt-2 text-zinc-400">
          Conectá tu Nostr para ver a quién seguís.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Amigos</h1>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row">
        <input
          className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50"
          placeholder="¿A qué estás jugando? (tu estado)"
          value={statusText}
          onChange={(e) => setStatusText(e.target.value)}
        />
        <Button variant="outline" onClick={setStatus}>
          Publicar estado
        </Button>
      </div>
      {statusMsg ? (
        <p className="mt-2 text-sm text-sky-400">{statusMsg}</p>
      ) : null}

      <div className="mt-6">
        {friends === null ? (
          <p className="text-sm text-zinc-500">Cargando desde relays…</p>
        ) : friends.length === 0 ? (
          <p className="text-zinc-400">
            No seguís a nadie todavía (o tu lista de contactos no está en estos
            relays).
          </p>
        ) : (
          <ul className="space-y-2">
            {friends.map((f) => (
              <li
                key={f.pubkey}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
              >
                {f.profile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.profile.picture}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {profileName(f.profile, shortId(f.npub))}
                    </span>
                    {f.isMember ? (
                      <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
                        Luna Negra
                      </span>
                    ) : null}
                  </div>
                  {f.status ? (
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs text-emerald-400">
                        🎮 {f.status.content}
                      </p>
                      {roomHref(f.status) ? (
                        <Link
                          href={roomHref(f.status)!}
                          className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                        >
                          Unirse
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                  {f.games.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.games.slice(0, 4).map((g) => (
                        <Link
                          key={g.slug}
                          href={`/game/${g.slug}`}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-white/20"
                        >
                          {g.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
                {f.isMember ? (
                  <Link href={`/messages?to=${f.npub}`}>
                    <Button variant="outline">Mensaje</Button>
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
