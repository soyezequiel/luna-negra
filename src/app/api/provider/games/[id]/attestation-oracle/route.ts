import { NextResponse } from "next/server";
import { Prisma, type Game } from "@prisma/client";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { syncGameToNostr } from "@/lib/announce-game";

/**
 * Oráculo de ATESTACIONES del juego (NGP kind:31338, spec §3.4): la pubkey con la
 * que el game server del proveedor firma "en la sala X ganó Y". El artículo 30023
 * la publica como tag ["oracle", pk] — la DELEGACIÓN que un verificador cruza
 * contra el firmante de cada 31338.
 *
 * - GET: estado actual.
 * - POST { pubkey }: declara la clave (hex de 64 o npub). Sin prueba de posesión:
 *   el único que puede declarar es el dueño autenticado del juego, y una clave
 *   equivocada solo rompe SU tier verificado (las atestaciones firman el gameCoord
 *   adentro, así que declarar una clave ajena no "roba" eventos de otro juego).
 * - DELETE: la quita (el juego deja de tener tier verificado).
 *
 * Es POR JUEGO y distinta de Provider.oraclePubkey (el oráculo de APUESTAS, que
 * NGE v2 fuerza a gestionado): esta clave la custodia el PROVEEDOR y Luna nunca
 * firma con ella. Tras declarar/quitar, el artículo debe re-publicarse — mismo
 * régimen que una edición de ficha (ver PATCH de ../route.ts): "store" re-firma
 * server-side; "provider" marca articleDirty y pide la firma (needsSignature).
 */

type RouteParams = { params: Promise<{ id: string }> };

const HEX64 = /^[0-9a-f]{64}$/;

/** Normaliza hex de 64 o npub a hex minúsculas, o null si no es una pubkey. */
function normalizePubkey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.startsWith("npub")) {
    try {
      const d = nip19.decode(s);
      if (d.type !== "npub") return null;
      s = d.data as string;
    } catch {
      return null;
    }
  }
  s = s.toLowerCase();
  return HEX64.test(s) ? s : null;
}

/** Actualiza la pubkey y propaga al artículo según régimen. Devuelve {game, needsSignature}. */
async function applyOracleChange(
  owned: { game: Game },
  pubkey: string | null,
  req: Request,
): Promise<{ game: Game; needsSignature: boolean }> {
  const data: Prisma.GameUpdateInput = { attestationOraclePubkey: pubkey };
  // Espejo de la edición de ficha: la delegación viaja EN el artículo, así que
  // cambiar el oráculo invalida la firma pendiente y ensucia el publicado.
  if (owned.game.articleSigner === "provider") {
    if (owned.game.status === "published") data.articleDirty = true;
    if (owned.game.signedArticle !== null) data.signedArticle = Prisma.DbNull;
  }

  let game = await prisma.game.update({ where: { id: owned.game.id }, data });
  let needsSignature = false;
  if (game.status === "published") {
    if (game.articleSigner === "provider") {
      needsSignature = true;
    } else {
      try {
        game = await syncGameToNostr(game, req);
      } catch (err) {
        console.error("[attestation-oracle] no se pudo re-publicar el artículo:", err);
      }
    }
  }
  return { game, needsSignature };
}

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ oraclePubkey: owned.game.attestationOraclePubkey });
}

export async function POST(req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  let body: { pubkey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const pubkey = normalizePubkey(body?.pubkey);
  if (!pubkey) {
    return NextResponse.json(
      { error: "La pubkey del oráculo debe ser hex de 64 o un npub válido", code: "BAD_PUBKEY" },
      { status: 400 },
    );
  }

  // Idempotente: re-declarar la misma clave no ensucia el artículo al pedo.
  if (owned.game.attestationOraclePubkey === pubkey) {
    return NextResponse.json({ ok: true, oraclePubkey: pubkey, needsSignature: false });
  }

  const { game, needsSignature } = await applyOracleChange(owned, pubkey, req);
  return NextResponse.json({
    ok: true,
    oraclePubkey: game.attestationOraclePubkey,
    needsSignature,
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  if (!owned.game.attestationOraclePubkey) {
    return NextResponse.json({ ok: true, oraclePubkey: null, needsSignature: false });
  }

  const { needsSignature } = await applyOracleChange(owned, null, req);
  return NextResponse.json({ ok: true, oraclePubkey: null, needsSignature });
}
