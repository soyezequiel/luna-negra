import { NextResponse } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { gameNoteText } from "@/lib/game-note";
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
 *   · como dev: compras pagadas, zaps, reseñas y comentarios en sus juegos;
 *   · como jugador: sus apuestas resueltas / premios listos.
 * Todo sale de la DB; los comentarios son un caché de los kind:1 de Nostr que
 * mantiene `comment-sync.ts` (Nostr es la fuente de verdad). Los eventos propios
 * se excluyen.
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

  const dismissedRows = await prisma.dismissedNotification.findMany({
    where: { userId: session.sub },
    select: { key: true },
  });
  const dismissed = dismissedRows.map((d) => d.key);

  const providers = await prisma.provider.findMany({
    where: { ownerId: session.sub },
    select: { id: true, games: { select: { id: true, slug: true, title: true } } },
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

    // Comentarios (kind:1) en tus juegos — caché Nostr (comment-sync). Excluye
    // los tuyos. La fuente de verdad es el evento; acá leemos rápido de la DB.
    const comments = await prisma.gameComment.findMany({
      where: {
        gameId: { in: gameIds },
        ...(me?.pubkey ? { authorPubkey: { not: me.pubkey } } : {}),
      },
      include: { game: { select: { slug: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    });
    for (const c of comments) {
      items.push({
        id: `comment:${c.eventId}`,
        type: "comment",
        at: c.createdAt.getTime(),
        gameSlug: c.game.slug,
        gameTitle: c.game.title,
        actorNpub: npubOf(c.authorPubkey),
        text: gameNoteText(c.content) || null,
        href: `/game/${c.game.slug}`,
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

  // Como jugador: apuestas resueltas / premios listos para cobrar (v1 + v2).
  const [parts, zapParts] = await Promise.all([
    prisma.betParticipant.findMany({
      where: { userId: session.sub, result: { not: "pending" } },
      include: { bet: { include: { game: { select: { slug: true, title: true } } } } },
      orderBy: { settledAt: "desc" },
      take: PER_SOURCE,
    }),
    prisma.zapBetParticipant.findMany({
      where: { userId: session.sub, result: { not: "pending" } },
      include: { bet: { include: { game: { select: { slug: true, title: true } } } } },
      orderBy: { settledAt: "desc" },
      take: PER_SOURCE,
    }),
  ]);
  const betText = (result: string, claimable: boolean): string =>
    claimable
      ? "Tu premio está listo para cobrar"
      : result === "won"
        ? "Ganaste tu apuesta"
        : result === "tie"
          ? "Tu apuesta terminó en empate"
          : "Perdiste tu apuesta";
  for (const part of parts) {
    const claimable = part.payoutStatus === "withdraw_pending";
    items.push({
      id: `bet:${part.id}`,
      type: "bet",
      at: (part.settledAt ?? part.createdAt).getTime(),
      gameSlug: part.bet.game.slug,
      gameTitle: part.bet.game.title,
      amountSats: part.payoutMsat ? Math.floor(Number(part.payoutMsat) / 1000) : null,
      text: betText(part.result, claimable),
      payoutDestination: part.payoutStatus === "paid" ? part.payoutDestination : null,
      href: `/bets/${part.bet.id}`,
    });
  }
  for (const part of zapParts) {
    const claimable = part.payoutStatus === "withdraw_pending";
    items.push({
      id: `zapbet:${part.id}`,
      type: "bet",
      at: (part.settledAt ?? part.createdAt).getTime(),
      gameSlug: part.bet.game.slug,
      gameTitle: part.bet.game.title,
      amountSats: part.payoutMsat ? Math.floor(Number(part.payoutMsat) / 1000) : null,
      text: betText(part.result, claimable),
      payoutDestination: part.payoutStatus === "paid" ? part.payoutDestination : null,
      payoutKind: part.payoutStatus === "paid" ? part.payoutKind : null,
      href: `/apuestas/${part.bet.id}`,
    });
  }

  items.sort((a, b) => b.at - a.at);

  // Filtramos los descartados acá (ya está todo en la DB) y mandamos también la
  // lista de claves para que el cliente filtre sus descartes optimistas.
  const dismissedSet = new Set(dismissed);
  const visible = items.filter((it) => !dismissedSet.has(it.id));

  const body: NotificationsResponse = {
    items: visible.slice(0, MAX_ITEMS),
    seenAt: me?.notificationsSeenAt ? me.notificationsSeenAt.getTime() : null,
    dismissed,
  };
  return NextResponse.json(body);
}
