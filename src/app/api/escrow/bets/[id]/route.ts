import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlayerAuth } from "@/lib/escrow-auth";
import { signWithdrawToken } from "@/lib/auth";
import { encodeLnurl } from "@/lib/lnurl";
import { msatToSats } from "@/lib/money";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await getPlayerAuth(req);

  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { game: true, provider: true, participants: { include: { user: true } } },
  });
  if (!bet) {
    return NextResponse.json(
      { error: "Apuesta no encontrada", code: "BET_NOT_FOUND" },
      { status: 404 },
    );
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
