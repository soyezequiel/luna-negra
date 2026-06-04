import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // segundos hasta el reset de la ventana
};

// --- Fallback en memoria (si no hay Upstash) ---
// No se comparte entre instancias serverless; sirve solo como guard básico.
type Hit = { count: number; reset: number };
const store = new Map<string, Hit>();
function memoryLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const hit = store.get(key);
  if (!hit || hit.reset < now) {
    store.set(key, { count: 1, reset: now + windowMs });
    return { success: true, limit, remaining: limit - 1, reset: Math.ceil(windowMs / 1000) };
  }
  const reset = Math.max(0, Math.ceil((hit.reset - now) / 1000));
  if (hit.count >= limit) return { success: false, limit, remaining: 0, reset };
  hit.count++;
  return { success: true, limit, remaining: Math.max(0, limit - hit.count), reset };
}

// --- Upstash Redis (rate-limit real, compartido entre instancias) ---
const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasUpstash ? Redis.fromEnv() : null;
const limiters = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowSec: number): Ratelimit {
  const k = `${limit}:${windowSec}`;
  let l = limiters.get(k);
  if (!l) {
    l = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s` as Duration),
      prefix: "ln-rl",
    });
    limiters.set(k, l);
  }
  return l;
}

/** Verifica el límite y devuelve el estado (para emitir headers estándar). */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (redis) {
    const r = await getLimiter(limit, Math.ceil(windowMs / 1000)).limit(key);
    return {
      success: r.success,
      limit: r.limit,
      remaining: Math.max(0, r.remaining),
      reset: Math.max(0, Math.ceil((r.reset - Date.now()) / 1000)),
    };
  }
  return memoryLimit(key, limit, windowMs);
}

/**
 * Headers estándar de rate-limit (draft IETF `RateLimit-*`).
 * En una respuesta 429 incluye además `Retry-After`.
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.reset),
  };
  if (!r.success) h["Retry-After"] = String(r.reset);
  return h;
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}
