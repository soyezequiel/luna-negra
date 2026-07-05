import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";

// Claves de API del proveedor para auth server-to-server (Bearer).
// Solo se guarda el hash; la clave en claro se muestra una vez al crearla.

const PREFIX = "ln_sk_";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Genera una clave nueva: { key (en claro, mostrar 1 vez), prefix, hash }. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

/** Identidad detrás de una API key: proveedor y (opcional) juego al que está acotada. */
export type ApiKeyIdentity = { providerId: string; gameId: string | null };

/**
 * Verifica `Authorization: Bearer ln_sk_…` y devuelve `{ providerId, gameId }`, o
 * null. `gameId` es el juego al que la clave quedó acotada (o null si es a nivel
 * proveedor). Actualiza `lastUsedAt` best-effort.
 */
export async function verifyApiKeyFull(req: Request): Promise<ApiKeyIdentity | null> {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+/i.test(auth)) return null;
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith(PREFIX)) return null;

  const row = await prisma.apiKey.findUnique({ where: { hash: hashApiKey(key) } });
  if (!row || row.revokedAt) return null;

  prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { providerId: row.providerId, gameId: row.gameId };
}

/**
 * Igual que `verifyApiKeyFull` pero devuelve solo el `providerId` (o null). Atajo
 * para las rutas que no necesitan el juego acotado.
 */
export async function verifyApiKey(req: Request): Promise<string | null> {
  const id = await verifyApiKeyFull(req);
  return id?.providerId ?? null;
}
