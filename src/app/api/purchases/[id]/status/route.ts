import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isInvoicePaid, lightningConfigured } from "@/lib/lightning";
import { maybePayout } from "@/lib/payments";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const purchase = await prisma.purchase.findUnique({ where: { id } });
  if (!purchase || purchase.userId !== session.sub) {
    return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  }

  if (purchase.status === "paid") {
    return NextResponse.json({ status: "paid" });
  }

  let paid = false;
  if (lightningConfigured() && purchase.paymentHash) {
    try {
      paid = await isInvoicePaid(purchase.paymentHash);
    } catch {
      return NextResponse.json({ status: "pending" });
    }
  }

  if (paid) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { status: "paid", paidAt: new Date() },
    });
    await maybePayout(purchase.id);
    return NextResponse.json({ status: "paid" });
  }

  return NextResponse.json({ status: "pending" });
}
