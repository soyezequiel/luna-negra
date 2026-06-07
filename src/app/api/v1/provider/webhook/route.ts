import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { buildWebhookUpdate } from "@/lib/webhooks";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Auto-registro del webhook usando SOLO la API key del proveedor (`ln_sk_…`).
// El game server configura su URL y lee su secreto de firma sin pasar por el
// panel humano. El endpoint queda acotado al proveedor resuelto desde la key.
//
// POST {url, regenerate?}  → setea la URL y devuelve {url, secret}. Generar el
//   secreto si no había (o si regenerate:true, que ROTA e invalida el anterior).
//   url vacía/ausente borra url+secret. URL inválida → 400.
// GET  → {url, secret} actual, sin rotar (para leer el secreto al arrancar).
//
// El secreto nunca se loguea; solo se devuelve al dueño autenticado por estos
// endpoints.

export function OPTIONS() {
  return corsPreflight();
}

const BAD_KEY = () =>
  apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);

export async function GET(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) return BAD_KEY();

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { webhookUrl: true, webhookSecret: true },
  });
  if (!provider) return apiError("PROVIDER_NOT_FOUND", "Proveedor no encontrado", 404);

  return apiOk({ url: provider.webhookUrl, secret: provider.webhookSecret });
}

export async function POST(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) return BAD_KEY();

  const rl = await checkRateLimit(`provider-webhook:${providerId}`, 30, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { webhookSecret: true },
  });
  if (!provider) return apiError("PROVIDER_NOT_FOUND", "Proveedor no encontrado", 404);

  const body = await req.json().catch(() => ({}));
  const data = buildWebhookUpdate((body as { url?: unknown })?.url, {
    regenerate: (body as { regenerate?: unknown })?.regenerate === true,
    currentSecret: provider.webhookSecret,
  });
  if (!data) {
    return apiError("INVALID_WEBHOOK_URL", "La URL debe empezar con http(s)://", 400);
  }

  const updated = await prisma.provider.update({
    where: { id: providerId },
    data,
  });
  return apiOk({ url: updated.webhookUrl, secret: updated.webhookSecret });
}
