import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWithdrawToken } from "@/lib/auth";
import { msatToSats } from "@/lib/money";

const CORS = { "Access-Control-Allow-Origin": "*" };

// LNURL-withdraw (LUD-03): el wallet pide los params del retiro.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const pid = await verifyWithdrawToken(token);
  if (!pid) {
    return NextResponse.json(
      { status: "ERROR", reason: "Token inválido o expirado" },
      { headers: CORS },
    );
  }
  const part = await prisma.betParticipant.findUnique({ where: { id: pid } });
  if (
    !part ||
    part.payoutStatus !== "withdraw_pending" ||
    !part.payoutMsat ||
    (part.withdrawDeadline && part.withdrawDeadline < new Date())
  ) {
    return NextResponse.json(
      { status: "ERROR", reason: "Retiro no disponible" },
      { headers: CORS },
    );
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  // Redondear a sat entero: WoS y la validación del callback trabajan en sats,
  // así evitamos invoices de "9,5 sats" que se rechazan.
  const sats = Number(msatToSats(part.payoutMsat));
  const amountMsat = sats * 1000;

  return NextResponse.json(
    {
      tag: "withdrawRequest",
      callback: `${proto}://${host}/api/escrow/lnurlw/${token}/callback`,
      k1: token,
      defaultDescription: "Retiro de apuesta — Luna Negra",
      minWithdrawable: amountMsat,
      maxWithdrawable: amountMsat,
    },
    { headers: CORS },
  );
}
