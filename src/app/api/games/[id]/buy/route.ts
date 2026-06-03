import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createInvoice, lightningConfigured } from "@/lib/lightning";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!(await checkRateLimit(`buy:${clientIp(req)}:${session.sub}`, 15, 60_000))) {
    return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }
  const { id } = await params;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const key = { userId_gameId: { userId: session.sub, gameId: id } };
  const existing = await prisma.purchase.findUnique({ where: key });
  if (existing?.status === "paid") {
    return NextResponse.json({ status: "paid", alreadyOwned: true });
  }

  // Juego gratis: entitlement inmediato.
  if (game.priceSats === 0) {
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
    return NextResponse.json({ status: "paid", free: true });
  }

  // Juego de pago: crear invoice (o placeholder en modo dev).
  const description = `Luna Negra · ${game.title}`;
  const devMode = !lightningConfigured();
  const inv = devMode
    ? {
        invoice: `lnbc-dev-${randomBytes(12).toString("hex")}`,
        paymentHash: `dev-${randomBytes(16).toString("hex")}`,
      }
    : await createInvoice(game.priceSats, description);

  const purchase = await prisma.purchase.upsert({
    where: key,
    update: {
      amountSats: game.priceSats,
      status: "pending",
      invoice: inv.invoice,
      paymentHash: inv.paymentHash,
      payoutStatus: "none",
      payoutHash: null,
      paidAt: null,
    },
    create: {
      userId: session.sub,
      gameId: id,
      amountSats: game.priceSats,
      status: "pending",
      invoice: inv.invoice,
      paymentHash: inv.paymentHash,
    },
  });

  return NextResponse.json({
    status: "pending",
    purchaseId: purchase.id,
    invoice: inv.invoice,
    amountSats: game.priceSats,
    devMode,
  });
}
