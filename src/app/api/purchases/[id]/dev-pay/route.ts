import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { emitPurchaseCompleted } from "@/lib/webhooks";

// Solo dev: simula el pago de un invoice para probar el flujo sin wallet.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const purchase = await prisma.purchase.findUnique({ where: { id } });
  if (!purchase || purchase.userId !== session.sub) {
    return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  }

  await prisma.purchase.update({
    where: { id: purchase.id },
    data: { status: "paid", paidAt: new Date(), payoutStatus: "skipped" },
  });

  after(() => emitPurchaseCompleted(purchase.id));
  return NextResponse.json({ status: "paid" });
}
