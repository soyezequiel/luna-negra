import { NextResponse } from "next/server";
import { getSession, signRoomInvite } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { npubOf, pubkeyFromNpub } from "@/lib/nostr-social";

// "Luna Room Link": genera un enlace de invitación a una sala HOSTEADA POR EL JUEGO
// sin abrir el juego ni registrar una fila `Room`. Ver docs/luna-room-link.md.
//
// A diferencia de `POST /api/invites` (que arma un link al dominio de Luna y crea
// una `GameInvite` dirigida a una sala de Luna), acá el enlace lleva el dominio del
// juego (`Game.gameUrl`) y la sala vive en el backend del juego (creada lazy).
//
// Auth: cookie de sesión first-party (NO API key). El invitador es el jugador
// logueado; la identidad sale de la cookie, no del body.
//
//   POST { gameId, roomId?, toNpub? } → { roomId, inviteUrl, lnInvite? }
//     - roomId ausente → se genera uno opaco (la sala no pre-existe).
//     - toNpub presente → variante DIRIGIDA: se firma un `lnInvite` (scope
//       "room-invite") que autoriza solo a ese npub. Sin `toNpub` → variante
//       PÚBLICA: cualquiera con el enlace entra.

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Código de sala corto y legible para compartir: 4 chars de un alfabeto sin
// caracteres ambiguos (sin 0/O/1/I), el mismo estilo que los códigos nativos de los
// juegos. Espacio ~1M; como no persistimos la sala (no hay dedupe), una colisión
// haría que dos enlaces compartan sala — improbable a esta escala y aceptable (el
// `roomId` es un identificador opaco, no un secreto).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars → sin sesgo de módulo
function generateRoomCode(length = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    gameId?: unknown;
    roomId?: unknown;
    toNpub?: unknown;
  };
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  if (!gameId) {
    return NextResponse.json({ error: "Falta gameId" }, { status: 400 });
  }

  // roomId: opcional. Si viene, validamos su forma; si no, generamos uno opaco.
  // No persistimos ninguna fila `Room`: la sala la crea el juego al primer acceso.
  let roomId: string;
  if (body.roomId === undefined || body.roomId === null || body.roomId === "") {
    roomId = generateRoomCode();
  } else if (typeof body.roomId === "string" && ROOM_RE.test(body.roomId.trim())) {
    roomId = body.roomId.trim();
  } else {
    return NextResponse.json({ error: "roomId inválido" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      slug: true,
      gameUrl: true,
      status: true,
      priceSats: true,
    },
  });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  // El enlace vive en el dominio del juego: sin `gameUrl` registrada no hay a dónde
  // apuntar (el juego no está hosteado en ningún lado que Luna conozca).
  if (!game.gameUrl) {
    return NextResponse.json(
      { error: "El juego no tiene una URL registrada" },
      { status: 400 },
    );
  }

  // Propiedad: mismo criterio que `mintRoomInvite`/`POST /api/invites` — juego
  // gratis o compra pagada.
  let owns = game.priceSats === 0;
  if (!owns) {
    const purchase = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: game.id } },
      select: { status: true },
    });
    owns = purchase?.status === "paid";
  }
  if (!owns) {
    return NextResponse.json({ error: "No tenés acceso a este juego" }, { status: 403 });
  }

  // Variante dirigida: si viene `toNpub`, firmamos un `lnInvite` para ese npub.
  let lnInvite: string | undefined;
  if (body.toNpub !== undefined && body.toNpub !== null && body.toNpub !== "") {
    const toPubkey = pubkeyFromNpub(String(body.toNpub));
    if (!toPubkey) {
      return NextResponse.json({ error: "toNpub inválido" }, { status: 400 });
    }
    const toNpub = npubOf(toPubkey);
    if (toNpub === session.npub) {
      return NextResponse.json(
        { error: "No podés invitarte a vos mismo" },
        { status: 400 },
      );
    }
    lnInvite = await signRoomInvite({
      gameId: game.id,
      slug: game.slug,
      roomId,
      toNpub,
    });
  }

  // Enlace canónico: <Game.gameUrl>/?lnRoom=<roomId>[&lnInvite=<jwt>].
  let inviteUrl: string;
  try {
    const url = new URL(game.gameUrl);
    url.searchParams.set("lnRoom", roomId);
    if (lnInvite) url.searchParams.set("lnInvite", lnInvite);
    inviteUrl = url.toString();
  } catch {
    return NextResponse.json(
      { error: "La URL del juego es inválida" },
      { status: 400 },
    );
  }

  return NextResponse.json({ roomId, inviteUrl, ...(lnInvite ? { lnInvite } : {}) });
}
