import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { maybePayout } from "@/lib/payments";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;

  // Resetear cualquier estado no-pagado para habilitar el reintento.
  await prisma.purchase.updateMany({
    where: { id, payoutStatus: { not: "paid" } },
    data: { payoutStatus: "none" },
  });
  await maybePayout(id);

  const p = await prisma.purchase.findUnique({
    where: { id },
    select: { payoutStatus: true, payoutHash: true },
  });
  return NextResponse.json({
    payoutStatus: p?.payoutStatus,
    payoutHash: p?.payoutHash,
  });
}
