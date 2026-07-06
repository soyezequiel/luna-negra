import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { getOracleSecret } from "@/lib/oracle-keys";
import { publishGameActivity } from "@/lib/nostr-server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Publica una nota de actividad del juego (kind:1, tag lunanegra:game:<slug>) que
// aparece en la pestaña Actividad. Auth = API key del proveedor; Luna Negra firma
// con el oráculo gestionado, así el game server no toca Nostr.
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const rl = await checkRateLimit(`game-activity:${providerId}`, 20, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  const body = await req.json().catch(() => ({}));
  const content = (body as { content?: unknown })?.content;
  if (typeof content !== "string" || !content.trim()) {
    return apiError("BAD_CONTENT", "Falta el contenido de la nota", 400);
  }
  if (content.length > 2000) {
    return apiError("CONTENT_TOO_LONG", "La nota excede 2000 caracteres", 400);
  }

  const game = await prisma.game.findUnique({
    where: { slug },
    select: { providerId: true, provider: { select: { oracleSelfSigned: true } } },
  });
  if (!game) return apiError("GAME_NOT_FOUND", "Juego no encontrado", 404);
  if (game.providerId !== providerId) {
    return apiError("FORBIDDEN", "El juego no es de tu proveedor", 403);
  }

  // Oráculo BYO (keyless): Luna no custodia la clave; la actividad la publica el
  // proveedor con su propia clave (kind:1 tagueando la coordenada del juego).
  if (game.provider.oracleSelfSigned) {
    return apiError(
      "SELF_SIGNED_ORACLE",
      "Este proveedor firma con su propia clave de oráculo; publicá la actividad vos mismo (kind:1 con el tag del juego)",
      409,
    );
  }

  const sk = await getOracleSecret(providerId);
  if (!sk) {
    return apiError(
      "ORACLE_NOT_PROVISIONED",
      "El proveedor no tiene clave de oráculo gestionada; contactá soporte para provisionarla",
      409,
    );
  }

  const posted = await publishGameActivity(sk, slug, content.trim());
  if (!posted) {
    return apiError("PUBLISH_FAILED", "Ningún relay aceptó la nota", 502);
  }
  return apiOk({ ok: true, eventId: posted.id, pubkey: posted.pubkey });
}
