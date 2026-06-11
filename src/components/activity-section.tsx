"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  // Guard síncrono: setPosting no alcanza contra un doble click más rápido
  // que el re-render, y cada envío extra publica otro evento en Nostr.
  const postingRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const ns = await fetchGameActivity(slug, root?.id);
    setNotes(ns);
    const authors = [...new Set(ns.map((n) => n.pubkey))];
    if (authors.length) setProfiles(await fetchProfiles(authors));
  }, [slug, root?.id]);

  useEffect(() => {
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

  async function post() {
    if (!text.trim() || postingRef.current) return;
    postingRef.current = true;
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
      postingRef.current = false;
      setPosting(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-[17px] font-semibold text-ink">
        Comentarios de la comunidad
      </h2>

      {user ? (
        <div className="mb-6 rounded border border-line bg-panel p-4">
          <textarea
            className="w-full rounded-sm border border-line bg-black/20 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
            rows={2}
            placeholder="Compartí algo sobre este juego…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button variant="blue" onClick={post} disabled={posting}>
              {posting ? "Publicando…" : "Publicar en Nostr"}
            </Button>
            {err ? (
              <span className="text-sm text-[var(--lose)]">{err}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-faint">
          Conectá tu Nostr para publicar.
        </p>
      )}

      {notes === null ? (
        <p className="text-sm text-faint">Cargando desde relays…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-faint">Todavía no hay comentarios.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded border border-line bg-panel p-4">
              <div className="flex items-center gap-2 text-xs text-faint">
                <span className="font-mono">
                  {profileName(profiles[n.pubkey], shortId(npubOf(n.pubkey)))}
                </span>
                <span>· {timeAgo(n.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {gameNoteText(n.content)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
