"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  fetchGameActivity,
  fetchProfiles,
  gameNoteText,
  profileName,
  publishGameNote,
  shortId,
  npubOf,
  type ActivityNote,
  type GameRoot,
  type Profile,
} from "@/lib/nostr-social";
import { timeAgo } from "@/lib/format";

export function ActivitySection({
  slug,
  title,
  root,
}: {
  slug: string;
  title: string;
  root: GameRoot | null;
}) {
  const { user } = useSession();
  const [notes, setNotes] = useState<ActivityNote[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ns = await fetchGameActivity(slug, root?.id);
    setNotes(ns);
    const authors = [...new Set(ns.map((n) => n.pubkey))];
    if (authors.length) setProfiles(await fetchProfiles(authors));
  }, [slug, root?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function post() {
    if (!text.trim()) return;
    setPosting(true);
    setErr(null);
    try {
      const gameUrl = `${window.location.origin}/game/${slug}`;
      await publishGameNote(slug, text.trim(), title, gameUrl, root);
      setText("");
      setTimeout(load, 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al publicar");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold">Actividad</h2>

      {user ? (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <textarea
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50"
            rows={2}
            placeholder="Compartí algo sobre este juego…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={post} disabled={posting}>
              {posting ? "Publicando…" : "Publicar en Nostr"}
            </Button>
            {err ? <span className="text-sm text-red-400">{err}</span> : null}
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-zinc-500">
          Conectá tu Nostr para publicar.
        </p>
      )}

      {notes === null ? (
        <p className="text-sm text-zinc-500">Cargando desde relays…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay actividad.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-white/10 bg-white/5 p-4"
            >
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-mono">
                  {profileName(profiles[n.pubkey], shortId(npubOf(n.pubkey)))}
                </span>
                <span>· {timeAgo(n.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                {gameNoteText(n.content)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
