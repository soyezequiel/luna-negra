import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { validateParticipationComment } from "@/lib/zap-bet";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Comentario de participación de una apuesta v2 (camino in-game / UI propia).
// El juego obtiene el kind:1 sin firmar en `participationComment` del
// GET /api/v2/bets/{id}, el jugador lo firma con su identidad y lo manda acá.
// Se guarda en el participante y lo publica la tienda: settleDepositV2 si llega
// antes de confirmarse el pago, o el tick v2 (bloque H) si llega después. El
// payout del ganador se ancla a este comentario en vez del post del contrato.
//
// Auth: la FIRMA del evento es la autenticación (como el 9734 del callback
// LNURL): validateParticipationComment exige firma válida, autor == pubkey del
// participante y `e` == ancla del contrato. No requiere sesión ni API key, así
// el juego puede mandarlo directo desde el cliente. Solo rate-limit por IP.

type SignedEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
  sig: string;
};

const ACTIVE = new Set(["pending_deposits", "ready"]);

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!BETS_V2_ENABLED) {
    return apiError("BETS_DISABLED", "Apuestas v2 desactivadas", 503);
  }
  const rl = await checkRateLimit(`v2-bet-comment:${clientIp(req)}`, 30, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  const body = await req.json().catch(() => null);
  const signed = (body as { signedComment?: unknown } | null)?.signedComment as
    | SignedEvent
    | undefined;
  if (
    !signed ||
    typeof signed !== "object" ||
    typeof signed.pubkey !== "string" ||
    typeof signed.sig !== "string"
  ) {
    return apiError("BAD_REQUEST", "Falta el comentario firmado (signedComment)", 400);
  }

  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  const part = bet.participants.find((p) => p.pubkey === signed.pubkey);
  if (!part) {
    return apiError(
      "NOT_PARTICIPANT",
      "El firmante del comentario no es participante de esta apuesta",
      403,
    );
  }
  // Después de liquidar/reembolsar ya no tiene sentido: el payout ya se ancló.
  if (!ACTIVE.has(bet.status)) {
    return apiError("BET_CLOSED", "La apuesta ya no acepta comentarios", 409);
  }

  const check = validateParticipationComment(bet, part, signed);
  if (!check.ok) return apiError("INVALID_COMMENT", check.error, 400);

  // Idempotente: si ya hay un comentario publicado, no lo pisamos (el payout
  // podría estar por anclarse a él). Si solo estaba guardado, aceptamos el nuevo.
  if (part.commentEventOk && part.commentEventId) {
    return apiOk({ saved: true, commentEventId: part.commentEventId, published: true });
  }
  const json = JSON.stringify(signed);
  if (part.commentEventJson !== json) {
    await prisma.zapBetParticipant.update({
      where: { id: part.id },
      data: { commentEventJson: json, commentEventId: null, commentEventOk: false },
    });
  }
  // Publicación: settleDepositV2 (si el depósito aún no se confirmó) o el tick v2
  // (bloque H, ~1 min) si el depósito ya está pago.
  return apiOk({ saved: true, commentEventId: signed.id, published: false });
}
