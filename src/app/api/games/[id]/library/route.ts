import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Gestión de "mi biblioteca" (entitlement) por fuera del flujo de compra:
//  - POST: agrega el juego a la biblioteca SIN pago (entitlement inmediato).
//    Permitido solo para juegos gratis publicados. Un juego de pago NO entra
//    por acá: se usa el flujo de compra (/buy).
//  - DELETE: quita el juego de la biblioteca. Solo entitlements gratuitos
//    (amountSats = 0); un juego que se pagó con sats no se quita acá para no
//    perder, sin querer, un acceso comprado.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const isFreePublished = game.status === "published" && game.priceSats === 0;
  if (!isFreePublished) {
    return NextResponse.json(
      { error: "Este juego se agrega comprándolo." },
      { status: 400 },
    );
  }

  const key = { userId_gameId: { userId: session.sub, gameId: id } };
  await prisma.purchase.upsert({
    where: key,
    update: { status: "paid", amountSats: 0, paidAt: new Date() },
    create: {
      userId: session.sub,
      gameId: id,
      amountSats: 0,
      status: "paid",
      paidAt: new Date(),
    },
  });
  return NextResponse.json({ status: "paid" });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const purchase = await prisma.purchase.findUnique({
    where: { userId_gameId: { userId: session.sub, gameId: id } },
  });
  if (!purchase) {
    // Ya no está en la biblioteca: idempotente.
    return NextResponse.json({ ok: true });
  }
  if (purchase.amountSats > 0) {
    return NextResponse.json(
      {
        error:
          "Este juego lo compraste con sats. No se quita de la biblioteca para no perder el acceso pagado.",
      },
      { status: 400 },
    );
  }
  await prisma.purchase.delete({
    where: { userId_gameId: { userId: session.sub, gameId: id } },
  });
  return NextResponse.json({ ok: true });
}
