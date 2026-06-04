import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInvite } from "@/lib/auth";
import { cacheProfile } from "@/lib/profile-cache";

// Heartbeat + roster de una sala multijugador (demo). El cliente postea cada
// ~2s con su puntaje; devuelve quién está en línea. Confiable en serverless
// (estado en Postgres), a diferencia de los relays. TTL: 15s sin heartbeat = fuera.
const STALE_MS = 15_000;

// El juego del proveedor puede vivir en otro origen → CORS abierto.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = await req.json().catch(() => ({}));

  // La identidad (npub/host) sale del token verificado, NO del cliente.
  const inv = await verifyInvite(
    typeof body.inviteToken === "string" ? body.inviteToken : "",
  );
  if (!inv || inv.roomId !== roomId) {
    return NextResponse.json(
      { error: "Invitación inválida para esta sala" },
      { status: 401, headers: CORS },
    );
  }

  const clientId = String(body.clientId ?? "").slice(0, 32);
  if (!clientId) {
    return NextResponse.json(
      { error: "falta clientId" },
      { status: 400, headers: CORS },
    );
  }
  const leaving = body.leave === true;
  const score = Math.max(0, Math.min(1_000_000, Math.floor(Number(body.score) || 0)));

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
  // Limpieza oportunista de presencias vencidas de esta sala.
  await prisma.roomPresence.deleteMany({
    where: { roomId, updatedAt: { lt: cutoff } },
  });
  const rows = await prisma.roomPresence.findMany({
    where: { roomId, updatedAt: { gte: cutoff } },
    select: { clientId: true, npub: true, host: true, score: true },
    orderBy: { createdAt: "asc" },
  });

  // Enriquecer con nombre/avatar cacheados (kind:0 al login) para mostrar el
  // nombre de usuario y la foto en vez de la npub.
  const npubs = [...new Set(rows.map((m) => m.npub))];
  const users = await prisma.user.findMany({
    where: { npub: { in: npubs } },
    select: { npub: true, pubkey: true, displayName: true, avatarUrl: true },
  });
  const byNpub = new Map(users.map((u) => [u.npub, u]));
  const members = rows.map((m) => ({
    ...m,
    name: byNpub.get(m.npub)?.displayName ?? null,
    avatar: byNpub.get(m.npub)?.avatarUrl ?? null,
  }));

  // Self-healing: para los que no tienen nombre cacheado, traer el kind:0 de
  // relays en background y cachearlo → aparece en el próximo poll. No frena
  // esta respuesta (los relays desde el server tardan unos segundos).
  const missing = users.filter((u) => !u.displayName);
  if (missing.length) {
    after(() =>
      Promise.allSettled(missing.map((u) => cacheProfile(u.pubkey))).then(
        () => undefined,
      ),
    );
  }

  return NextResponse.json({ members }, { headers: CORS });
}
