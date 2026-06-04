import { prisma } from "@/lib/prisma";
import { verifyInvite } from "@/lib/auth";

// Núcleo de la presencia de salas multijugador, compartido por la ruta v1 y la
// vieja. TTL: 15s sin heartbeat = fuera de la sala.
const STALE_MS = 15_000;

export type PresenceMember = {
  clientId: string;
  npub: string;
  host: boolean;
  score: number;
  name: string | null;
  avatar: string | null;
};

export type PresenceInput = {
  inviteToken: string;
  clientId: string;
  score: number;
  leave: boolean;
};

export type PresenceResult =
  | { ok: true; members: PresenceMember[]; missingPubkeys: string[] }
  | { ok: false; code: string; message: string; status: number };

/**
 * Procesa un heartbeat de presencia: valida el token, upsert/borra la fila,
 * limpia vencidas y devuelve el roster enriquecido con nombre/avatar cacheados.
 * `missingPubkeys` son los que aún no tienen perfil → el caller los resuelve en
 * background (next/server `after`).
 */
export async function resolvePresence(
  roomId: string,
  input: { inviteToken: unknown; clientId: unknown; score: unknown; leave: unknown },
): Promise<PresenceResult> {
  // La identidad (npub/host) sale del token verificado, NO del cliente.
  const inv = await verifyInvite(
    typeof input.inviteToken === "string" ? input.inviteToken : "",
  );
  if (!inv || inv.roomId !== roomId) {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "Invitación inválida para esta sala",
      status: 401,
    };
  }

  const clientId = String(input.clientId ?? "").slice(0, 32);
  if (!clientId) {
    return { ok: false, code: "MISSING_CLIENT_ID", message: "Falta clientId", status: 400 };
  }
  const leaving = input.leave === true;
  const score = Math.max(0, Math.min(1_000_000, Math.floor(Number(input.score) || 0)));

  if (leaving) {
    await prisma.roomPresence
      .delete({ where: { roomId_clientId: { roomId, clientId } } })
      .catch(() => {});
  } else {
    await prisma.roomPresence.upsert({
      where: { roomId_clientId: { roomId, clientId } },
      create: { roomId, clientId, npub: inv.npub, host: inv.host, score },
      update: { npub: inv.npub, host: inv.host, score },
    });
  }

  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.roomPresence.deleteMany({ where: { roomId, updatedAt: { lt: cutoff } } });
  const rows = await prisma.roomPresence.findMany({
    where: { roomId, updatedAt: { gte: cutoff } },
    select: { clientId: true, npub: true, host: true, score: true },
    orderBy: { createdAt: "asc" },
  });

  // Enriquecer con nombre/avatar cacheados (kind:0).
  const npubs = [...new Set(rows.map((m) => m.npub))];
  const users = await prisma.user.findMany({
    where: { npub: { in: npubs } },
    select: { npub: true, pubkey: true, displayName: true, avatarUrl: true },
  });
  const byNpub = new Map(users.map((u) => [u.npub, u]));
  const members: PresenceMember[] = rows.map((m) => ({
    ...m,
    name: byNpub.get(m.npub)?.displayName ?? null,
    avatar: byNpub.get(m.npub)?.avatarUrl ?? null,
  }));

  const missingPubkeys = users
    .filter((u) => !u.displayName || !u.avatarUrl)
    .map((u) => u.pubkey);

  return { ok: true, members, missingPubkeys };
}
