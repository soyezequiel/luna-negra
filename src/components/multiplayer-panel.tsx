"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { Button } from "@/components/ui/button";
import {
  publishPlayingStatus,
  fetchContacts,
  fetchProfiles,
  sendDm,
  profileName,
  npubOf,
  shortId,
  pubkeyFromNpub,
} from "@/lib/nostr-social";
import { buildInviteMessage } from "@/lib/invite";

type InviteResp = { token: string; roomId: string; host: boolean };

type Friend = { pubkey: string; npub: string; name: string; isMember: boolean };

type KnownEntry = { pubkey: string; displayName: string | null };

/**
 * Multijugador por **link de invitación** (sin registro de salas en DB):
 * - El dueño crea una sala ("Jugar con amigos") → comparte el link.
 * - Quien abre el link (logueado y dueño del juego) se une con su propio token.
 * El lobby real lo hostea el proveedor; el token se valida en /api/v1/rooms/verify.
 */
export function MultiplayerPanel({
  gameId,
  slug,
  title,
  gameUrl,
}: {
  gameId: string;
  slug: string;
  title: string;
  gameUrl: string;
}) {
  const { user, login } = useSession();
  const { notify } = useNotify();
  const params = useSearchParams();
  const roomParam = params.get("room");

  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado del invitador (amigos + npub manual).
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [npubInput, setNpubInput] = useState("");
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const launch = useCallback(
    (token: string, roomId: string) => {
      const url = new URL(gameUrl, window.location.origin);
      url.searchParams.set("inviteToken", token);
      url.searchParams.set("room", roomId);
      window.open(url.toString(), "_blank", "noopener");
      // Presencia NIP-38 "jugando X" con el link de la sala → los amigos pueden
      // unirse desde /friends sin que les pase el link (descubrimiento vía Nostr).
      const link = new URL(
        `/game/${slug}?room=${encodeURIComponent(roomId)}`,
        window.location.origin,
      ).toString();
      publishPlayingStatus(title, link).catch(() => {});
    },
    [gameUrl, slug, title],
  );

  const post = useCallback(
    async (path: string): Promise<InviteResp | null> => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(path, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(d.error ?? "No se pudo crear la invitación");
          return null;
        }
        return d as InviteResp;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  async function joinRoom() {
    if (!roomParam) return;
    // Unirse a una sala existente.
    const d = await post(
      `/api/games/${gameId}/rooms/${encodeURIComponent(roomParam)}/members`,
    );
    if (d) launch(d.token, d.roomId);
  }

  async function createRoom() {
    // Crear una sala nueva (host).
    const d = await post(`/api/games/${gameId}/rooms`);
    if (!d) return;
    setRoomId(d.roomId);
    setInviteLink(`${window.location.origin}/game/${slug}?room=${d.roomId}`);
    launch(d.token, d.roomId);
  }

  // Cargar amigos (Nostr) una vez creada la sala, con los de Luna Negra arriba.
  useEffect(() => {
    if (!roomId || !user || friends !== null) return;
    let cancelled = false;
    (async () => {
      const contacts = await fetchContacts(user.pubkey);
      if (contacts.length === 0) {
        if (!cancelled) setFriends([]);
        return;
      }
      const [profiles, knownRes] = await Promise.all([
        fetchProfiles(contacts),
        fetch("/api/users/known", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pubkeys: contacts }),
        })
          .then((r) => r.json())
          .catch(() => ({ known: [] })),
      ]);
      const memberPks = new Set<string>(
        (knownRes.known ?? []).map((k: KnownEntry) => k.pubkey),
      );
      const list: Friend[] = contacts.map((pk) => ({
        pubkey: pk,
        npub: npubOf(pk),
        name: profileName(profiles[pk], shortId(npubOf(pk))),
        isMember: memberPks.has(pk),
      }));
      list.sort((a, b) => {
        if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      if (!cancelled) setFriends(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, user, friends]);

  async function invite(recipientPubkey: string, name: string) {
    if (!roomId || invitingPk) return;
    setInvitingPk(recipientPubkey);
    setError(null);
    try {
      await sendDm(
        recipientPubkey,
        buildInviteMessage({
          slug,
          roomId,
          title,
          origin: window.location.origin,
        }),
      );
      setInvited((prev) => new Set(prev).add(recipientPubkey));
      notify({ title: `Invitación enviada a ${name}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la invitación");
    } finally {
      setInvitingPk(null);
    }
  }

  function inviteByNpub() {
    const pk = pubkeyFromNpub(npubInput);
    if (!pk) {
      setError("npub inválido");
      return;
    }
    setNpubInput("");
    void invite(pk, shortId(npubOf(pk)));
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Invitado sin sesión: pedir login.
  if (!user) {
    if (!roomParam) return null;
    return (
      <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
        <p className="text-sm text-zinc-300">
          Te invitaron a una sala. Conectá tu Nostr para unirte.
        </p>
        <Button className="mt-3" onClick={login}>
          Conectar con Nostr
        </Button>
      </div>
    );
  }

  // Modo "unirse" (vino por un link de invitación).
  if (roomParam) {
    return (
      <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
        <p className="text-sm text-zinc-300">
          Te invitaron a la sala <code className="text-sky-300">{roomParam}</code>.
        </p>
        <Button className="mt-3" onClick={joinRoom} disabled={loading}>
          {loading ? "Entrando…" : "Unirse y jugar"}
        </Button>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </div>
    );
  }

  // Modo "host" (dueño creando una sala).
  return (
    <div className="mt-4">
      <Button variant="outline" onClick={createRoom} disabled={loading}>
        {loading ? "Creando sala…" : "🎮 Jugar con amigos"}
      </Button>
      {inviteLink ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-zinc-400">
            Compartí este link con un amigo que también tenga el juego:
          </p>
          <button
            onClick={copyLink}
            className="mt-2 w-full truncate rounded-md border border-white/15 px-3 py-2 text-left font-mono text-xs text-zinc-300 hover:bg-white/5"
          >
            {copied ? "¡Copiado!" : inviteLink}
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            Tu sala ya se abrió en otra pestaña. Cuando tu amigo entre, se ven en
            el lobby.
          </p>
        </div>
      ) : null}

      {/* Invitar amigos: les llega un DM con el link de la sala. */}
      {roomId ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-medium text-zinc-200">Invitar amigos</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Le enviamos un mensaje con la invitación. Si está en Luna Negra, le
            llega una notificación.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs outline-none focus:border-sky-500/50"
              placeholder="Pegá un npub…"
              value={npubInput}
              onChange={(e) => setNpubInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") inviteByNpub();
              }}
            />
            <Button variant="outline" onClick={inviteByNpub} disabled={!!invitingPk}>
              Invitar
            </Button>
          </div>

          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {friends === null ? (
              <p className="text-xs text-zinc-500">Cargando amigos…</p>
            ) : friends.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No seguís a nadie en Nostr (o tu lista no está en estos relays).
                Usá el npub de arriba.
              </p>
            ) : (
              friends.map((f) => (
                <div
                  key={f.pubkey}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {f.name}
                  </span>
                  {f.isMember ? (
                    <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
                      Luna Negra
                    </span>
                  ) : null}
                  <button
                    onClick={() => invite(f.pubkey, f.name)}
                    disabled={invited.has(f.pubkey) || invitingPk === f.pubkey}
                    className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {invited.has(f.pubkey)
                      ? "✓ Invitado"
                      : invitingPk === f.pubkey
                        ? "Enviando…"
                        : "Invitar"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
