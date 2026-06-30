import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, signEntitlement, signBetSession } from "@/lib/auth";
import {
  GUEST_COOKIE,
  guestCookieOptions,
  guestCookieValue,
  newGuestIdentity,
  readGuestIdentity,
} from "@/lib/guest-session";
import { recordPlayClick } from "@/lib/play-click";

// Crea una "sesión de juego": mintea el token de acceso (entitlement) para lanzar
// el juego, si el jugador lo posee (o es gratis). Los juegos GRATIS también se
// pueden jugar sin iniciar sesión: se usa una identidad de invitado efímera.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const session = await getSession();

  // --- Invitado (sin cuenta Nostr): solo juegos gratis ---
  if (!session) {
    if (game.priceSats !== 0) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const existing = await readGuestIdentity();
    const guest = existing ?? newGuestIdentity();
    const token = await signEntitlement({
      npub: guest.npub,
      pubkey: guest.pubkey,
      gameId: id,
      slug: game.slug,
    });
    // Estima concurrencia por clicks si el juego no integra presencia (best-effort).
    await recordPlayClick(game.providerId, id, guest.npub).catch(() => {});
    const res = NextResponse.json({ token, guest: true });
    // Persistir la identidad para que el navegador conserve el mismo npub entre
    // partidas (progreso del juego, etc.). No se mintea bet-session: apostar
    // requiere una cuenta real.
    if (!existing) {
      res.cookies.set(GUEST_COOKIE, await guestCookieValue(guest), guestCookieOptions);
    }
    return res;
  }

  // --- Usuario logueado ---
  let owns = game.priceSats === 0;
  if (!owns) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: id } },
    });
    owns = p?.status === "paid";
  }
  if (!owns) {
    return NextResponse.json(
      { error: "No tenés acceso a este juego" },
      { status: 403 },
    );
  }

  // Marca "jugó alguna vez / última vez" (ordena la lista de amigos).
  await prisma.user
    .update({ where: { id: session.sub }, data: { lastPlayedAt: new Date() } })
    .catch(() => {});

  // Estima concurrencia por clicks si el juego no integra presencia (best-effort).
  await recordPlayClick(game.providerId, id, session.npub).catch(() => {});

  const token = await signEntitlement({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId: id,
    slug: game.slug,
  });
  // Token de mínimo privilegio para que el modal de apuestas opere como el jugador.
  const betSession = await signBetSession({
    sub: session.sub,
    npub: session.npub,
    pubkey: session.pubkey,
  });
  return NextResponse.json({ token, betSession });
}
