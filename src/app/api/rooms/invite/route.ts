import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { npubOf, pubkeyFromNpub } from "@/lib/nostr-social";
import { queueRoomLinkLaunchRequest } from "@/lib/game-launch-requests";

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
//   POST { gameId, roomId?, toNpub? } → { roomId, inviteUrl }
//     - roomId ausente → se genera uno opaco (la sala no pre-existe).
//     - El enlace es SIEMPRE ABIERTO (`?lnRoom=`): quien lo tenga entra con su
//       identidad actual. No se firma ningún token dirigido.
//     - toNpub presente → es un amigo puntual: además de devolver el enlace, le
//       encolamos la orden de entrada para que su juego YA ABIERTO muestre el
//       popup (abre ese mismo enlace abierto). No cambia el enlace ni la sala.

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
      providerId: true,
      slug: true,
      title: true,
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

  // Destinatario opcional: si viene `toNpub`, es un amigo puntual al que además
  // le encolamos el popup. NO firmamos token dirigido: el enlace es siempre
  // abierto, así que sólo validamos el npub para saber a quién avisar.
  let targetNpub: string | undefined;
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
    targetNpub = toNpub;
  }

  // Enlace canónico ABIERTO: <Game.gameUrl>/?lnRoom=<roomId>. Sin token: cualquiera
  // con el enlace entra con su identidad actual.
  let inviteUrl: string;
  try {
    const url = new URL(game.gameUrl);
    url.searchParams.set("lnRoom", roomId);
    inviteUrl = url.toString();
  } catch {
    return NextResponse.json(
      { error: "La URL del juego es inválida" },
      { status: 400 },
    );
  }

  // Con destinatario, encolamos la orden de entrada para que el juego ya abierto
  // muestre el popup, que abre el MISMO enlace abierto (sin token). El DM sigue
  // cubriendo a quien tenga el juego cerrado.
  const launchQueued = targetNpub
    ? await queueRoomLinkLaunchRequest({
        providerId: game.providerId,
        npub: targetNpub,
        roomId,
        lnInvite: "",
        slug: game.slug,
        title: game.title,
        inviteUrl,
      })
    : false;

  return NextResponse.json({ roomId, inviteUrl, launchQueued });
}
