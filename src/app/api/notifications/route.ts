import { NextResponse } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { NotifItem, NotificationsResponse } from "@/lib/notifications";

// Cuántos ítems traer por fuente antes de mezclar y recortar.
const PER_SOURCE = 30;
const MAX_ITEMS = 50;

function npubOf(pubkeyHex: string): string {
  try {
    return nip19.npubEncode(pubkeyHex);
  } catch {
    return pubkeyHex;
  }
}

/**
 * Feed de notificaciones del usuario (campanita). Reúne, en una sola lista
 * ordenada por fecha:
 *   · como dev: compras pagadas, zaps y reseñas en sus juegos;
 *   · como jugador: sus apuestas resueltas / premios listos.
 * Devuelve además los juegos con anuncio en Nostr para que el cliente sume los
 * comentarios kind:1 (que no viven en la DB). Los eventos propios se excluyen.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { notificationsSeenAt: true, pubkey: true },
  });

  const providers = await prisma.provider.findMany({
    where: { ownerId: session.sub },
    select: { id: true, games: { select: { id: true, slug: true, title: true, nostrEventId: true, nostrPubkey: true } } },
  });
  const providerIds = providers.map((p) => p.id);
  const games = providers.flatMap((p) => p.games);
  const gameIds = games.map((g) => g.id);

  const items: NotifItem[] = [];

  if (gameIds.length > 0) {
    // Compras de tus juegos (excluye las tuyas).
    const purchases = await prisma.purchase.findMany({
      where: { gameId: { in: gameIds }, status: "paid", userId: { not: session.sub } },
      include: { game: { select: { slug: true, title: true } }, user: { select: { displayName: true, npub: true } } },
      orderBy: { paidAt: "desc" },
      take: PER_SOURCE,
    });
    for (const p of purchases) {
      items.push({
        id: `purchase:${p.id}`,
        type: "purchase",
        at: (p.paidAt ?? p.createdAt).getTime(),
        gameSlug: p.game.slug,
        gameTitle: p.game.title,
        actorName: p.user.displayName,
        actorNpub: p.user.npub,
        amountSats: p.amountSats,
        href: `/game/${p.game.slug}`,
      });
    }

    // Reseñas en tus juegos (excluye las tuyas).
    const reviews = await prisma.review.findMany({
      where: { gameId: { in: gameIds }, userId: { not: session.sub } },
      include: { game: { select: { slug: true, title: true } }, user: { select: { displayName: true, npub: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    });
    for (const r of reviews) {
      items.push({
        id: `review:${r.id}`,
        type: "review",
        at: r.createdAt.getTime(),
        gameSlug: r.game.slug,
        gameTitle: r.game.title,
        actorName: r.user.displayName,
        actorNpub: r.user.npub,
        rating: r.rating,
        text: r.body || null,
        href: `/game/${r.game.slug}`,
      });
    }
  }

  if (providerIds.length > 0) {
    // Zaps a tus juegos (excluye los que te hayas mandado vos mismo).
    const zaps = await prisma.zap.findMany({
      where: {
        providerId: { in: providerIds },
        ...(me?.pubkey ? { zapperPubkey: { not: me.pubkey } } : {}),
      },
      include: { game: { select: { slug: true, title: true } } },
      orderBy: { zappedAt: "desc" },
      take: PER_SOURCE,
    });
    for (const z of zaps) {
      items.push({
        id: `zap:${z.id}`,
        type: "zap",
        at: z.zappedAt.getTime(),
        gameSlug: z.game.slug,
        gameTitle: z.game.title,
        actorNpub: npubOf(z.zapperPubkey),
        amountSats: z.amountSats,
        text: z.comment || null,
        href: `/game/${z.game.slug}`,
      });
    }
  }

  // Como jugador: apuestas resueltas / premios listos para cobrar.
  const parts = await prisma.betParticipant.findMany({
    where: { userId: session.sub, result: { not: "pending" } },
    include: { bet: { include: { game: { select: { slug: true, title: true } } } } },
    orderBy: { settledAt: "desc" },
    take: PER_SOURCE,
  });
  for (const part of parts) {
    const claimable = part.payoutStatus === "withdraw_pending";
    const resultText =
      part.result === "won"
        ? "Ganaste tu apuesta"
        : part.result === "tie"
          ? "Tu apuesta terminó en empate"
          : "Perdiste tu apuesta";
    items.push({
      id: `bet:${part.id}`,
      type: "bet",
      at: (part.settledAt ?? part.createdAt).getTime(),
      gameSlug: part.bet.game.slug,
      gameTitle: part.bet.game.title,
      amountSats: part.payoutMsat ? Math.floor(Number(part.payoutMsat) / 1000) : null,
      text: claimable ? "Tu premio está listo para cobrar" : resultText,
      href: "/bets",
    });
  }

  items.sort((a, b) => b.at - a.at);

  const body: NotificationsResponse = {
    items: items.slice(0, MAX_ITEMS),
    seenAt: me?.notificationsSeenAt ? me.notificationsSeenAt.getTime() : null,
    games: games
      .filter((g): g is typeof g & { nostrEventId: string; nostrPubkey: string } =>
        Boolean(g.nostrEventId && g.nostrPubkey),
      )
      .map((g) => ({
        slug: g.slug,
        title: g.title,
        nostrEventId: g.nostrEventId,
        nostrPubkey: g.nostrPubkey,
      })),
  };
  return NextResponse.json(body);
}
