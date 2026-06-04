import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInvite } from "@/lib/auth";

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
  const members = await prisma.roomPresence.findMany({
    where: { roomId, updatedAt: { gte: cutoff } },
    select: { clientId: true, npub: true, host: true, score: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ members }, { headers: CORS });
}
