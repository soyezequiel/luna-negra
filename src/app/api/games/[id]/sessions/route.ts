import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, signBetSession } from "@/lib/auth";
import { recordPlayClick } from "@/lib/play-click";
import { purchaseVerificationDisabled } from "@/lib/capability-mode";

// Crea una "sesión de juego": verifica el acceso (compra/gratis) y prepara el
// lanzamiento. La identidad del jugador es SIEMPRE por Nostr (el juego loguea por
// NIP-07/46, NGP): Luna no mintea ningún token de identidad. Los juegos GRATIS se
// pueden lanzar sin cuenta; el juego resuelve la identidad por su cuenta.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  // --- Sin sesión (juego de acceso abierto): el juego resuelve la identidad ---
  if (!session) {
    if (!openAccess) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    return NextResponse.json({ nostrLogin: true, guest: true });
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
  // jugador. Es de la UI de Luna, no del juego.
  const betSession = await signBetSession({
    sub: session.sub,
    npub: session.npub,
    pubkey: session.pubkey,
  });

  return NextResponse.json({ nostrLogin: true, betSession });
}
