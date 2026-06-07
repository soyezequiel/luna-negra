import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { ensureDepositInvoice } from "@/lib/escrow-deposit";
import { encodeLnurl } from "@/lib/lnurl";
import { publicBetStatus } from "@/lib/escrow-math";
import { msatToSats } from "@/lib/money";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Handles de pago por participante (Bearer API key del proveedor dueño).
// Cada participante recibe: bolt11 (invoice fijo = stake), lnurl (LNURL-pay) y
// payUrl (deep-link a la pantalla de pago de Luna Negra). El plazo para pagar es
// `depositDeadline`: si vence sin completarse el pozo, se reembolsa y se cancela.
export function OPTIONS() {
  return corsPreflight();
}

function baseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const { id } = await params;
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }

  const base = baseUrl(req);
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());

  const deposits = [];
  for (const p of bet.participants) {
    // Solo generamos/exponemos handles mientras el depósito esté abierto y el
    // participante no haya pagado. Si está cerrado, devolvemos el estado sin handle.
    let bolt11: string | null = null;
    let lnurl: string | null = null;
    let payUrl: string | null = null;
    if (open && p.depositStatus === "pending") {
      const inv = await ensureDepositInvoice(bet, p);
      bolt11 = inv.invoice;
      lnurl = encodeLnurl(`${base}/api/escrow/lnurlp/${p.id}`);
      payUrl = `${base}/bets/${bet.id}`;
    }
    deposits.push({
      npub: p.npub,
      depositStatus: p.depositStatus, // pending | paid | refunded | failed
      bolt11,
      lnurl,
      payUrl,
    });
  }

  const sats = Number(msatToSats(bet.stakeMsat));
  const paid = bet.participants.filter((p) => p.depositStatus === "paid").length;

  return apiOk({
    betId: bet.id,
    status: publicBetStatus(bet.status),
    stakeSats: sats,
    potSats: sats * paid,
    potTargetSats: sats * bet.participants.length,
    depositsReceived: paid,
    depositsTotal: bet.participants.length,
    depositDeadline: bet.depositDeadline?.toISOString() ?? null,
    deposits,
  });
}
