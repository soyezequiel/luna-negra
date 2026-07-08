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
import { capMode, purchaseVerificationDisabled } from "@/lib/capability-mode";

// Crea una "sesión de juego": mintea el token de acceso (entitlement) para lanzar
// el juego, si el jugador lo posee (o es gratis). Los juegos GRATIS también se
// pueden jugar sin iniciar sesión: se usa una identidad de invitado efímera.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Ramal "Luna Room Link": lo señala el caller con `{ roomLink: true }`. Room Link
  // NO es retro-compatible — su identidad es SIEMPRE por Nostr (el juego loguea por
  // NIP-07/46), nunca por `lnToken`. Ver docs/luna-room-link.md. El resto de flujos
  // (launch standalone, apuestas) NO manda el flag y sigue respetando `capsMode`.
  const body = (await req.json().catch(() => null)) as { roomLink?: boolean } | null;
  const roomLink = body?.roomLink === true;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const session = await getSession();

  // "Acceso abierto": gratis (priceSats 0) o el proveedor desactivó la verificación
  // de compra (Game.capsMode.purchase = "off"). En ambos casos el juego se puede
  // lanzar sin poseerlo. Ver src/lib/capability-mode.ts.
  const openAccess =
    game.priceSats === 0 || purchaseVerificationDisabled(game.capsMode);

  // Login por Nostr: Luna NO mintea lnToken. El juego identifica al jugador por
  // NIP-07/46 y el link va limpio (solo lnOrigin). Se mantiene el gate de acceso
  // (openAccess/compra); solo se omite el token de identidad. Es SIEMPRE así en el
  // ramal Room Link (no retro-compatible); para el resto, se decide por capsMode.
  const nostrLogin = roomLink || capMode(game.capsMode, "identidad") === "nostr";

  // --- Invitado (sin cuenta Nostr): solo juegos de acceso abierto ---
  if (!session) {
    if (!openAccess) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    // Login por Nostr: sin token ni identidad de invitado (el juego la resuelve solo).
    if (nostrLogin) {
      return NextResponse.json({ nostrLogin: true, guest: true });
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
  let owns = openAccess;
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

  // Token de mínimo privilegio para que el modal de apuestas (Luna) opere como el
  // jugador. Se mintea aunque el login sea por Nostr: es de la UI de Luna, no del juego.
  const betSession = await signBetSession({
    sub: session.sub,
    npub: session.npub,
    pubkey: session.pubkey,
  });

  // Login por Nostr: sin lnToken (el juego usa NIP-07/46). El link va limpio.
  if (nostrLogin) {
    return NextResponse.json({ nostrLogin: true, betSession });
  }

  const token = await signEntitlement({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId: id,
    slug: game.slug,
  });
  return NextResponse.json({ token, betSession });
}
