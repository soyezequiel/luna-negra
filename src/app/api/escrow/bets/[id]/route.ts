import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlayerAuth } from "@/lib/escrow-auth";
import { signWithdrawToken } from "@/lib/auth";
import { encodeLnurl } from "@/lib/lnurl";
import { msatToSats } from "@/lib/money";
import { checkAndSettleDeposit } from "@/lib/escrow-tick";

const betInclude = {
  game: true,
  provider: true,
  participants: { include: { user: true } },
} as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await getPlayerAuth(req);

  let bet = await prisma.bet.findUnique({
    where: { id },
    include: betInclude,
  });
  if (!bet) {
    return NextResponse.json(
      { error: "Apuesta no encontrada", code: "BET_NOT_FOUND" },
      { status: 404 },
    );
  }

  // Detección on-demand: si el que consulta tiene su depósito pendiente,
  // verificamos el invoice ya mismo (no esperamos al tick de ~1 min). Esto hace
  // que el pago del QR se detecte dentro del ciclo de polling de 3 s del front.
  if (auth && bet.status === "pending_deposits") {
    const mine = bet.participants.find((p) => p.userId === auth.sub);
    if (mine && mine.depositStatus === "pending") {
      const settled = await checkAndSettleDeposit(mine.id);
      if (settled) {
        bet = (await prisma.bet.findUnique({ where: { id }, include: betInclude }))!;
      }
    }
  }

  const participants = bet.participants.map((p) => ({
    npub: p.npub,
    name: p.user.displayName,
    paid: p.depositStatus === "paid",
    refunded: p.depositStatus === "refunded",
  }));

  let me: null | {
    paid: boolean;
    result: string;
    payoutStatus: string;
    depositInvoice: string | null;
    withdrawUrl: string | null;
  } = null;
  if (auth) {
    const mine = bet.participants.find((p) => p.userId === auth.sub);
    if (mine) {
      let withdrawUrl: string | null = null;
      if (
        mine.payoutStatus === "withdraw_pending" &&
        mine.withdrawDeadline &&
        mine.withdrawDeadline > new Date()
      ) {
        const token = await signWithdrawToken(
          mine.id,
          Math.floor(mine.withdrawDeadline.getTime() / 1000),
        );
        const host =
          req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        withdrawUrl = encodeLnurl(
          `${proto}://${host}/api/escrow/lnurlw/${token}`,
        );
      }
      me = {
        paid: mine.depositStatus === "paid",
        result: mine.result,
        payoutStatus: mine.payoutStatus,
        depositInvoice: mine.depositInvoice,
        withdrawUrl,
      };
    }
  }

  return NextResponse.json({
    id: bet.id,
    status: bet.status,
    stakeSats: Number(msatToSats(bet.stakeMsat)),
    feePct: bet.feePct,
    devFeePct: bet.devFeePct,
    victoryCondition: bet.victoryCondition,
    depositDeadline: bet.depositDeadline,
    resolveDeadline: bet.resolveDeadline,
    contractEventId: bet.contractEventId,
    gameTitle: bet.game.title,
    gameSlug: bet.game.slug,
    providerName: bet.provider.name,
    participants,
    me,
  });
}
