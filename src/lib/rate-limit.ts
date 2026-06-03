import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// --- Fallback en memoria (si no hay Upstash) ---
// No se comparte entre instancias serverless; sirve solo como guard básico.
type Hit = { count: number; reset: number };
const store = new Map<string, Hit>();
function memoryLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hit = store.get(key);
  if (!hit || hit.reset < now) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count++;
  return true;
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

/** Devuelve true si la request está permitida (dentro del límite). */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (redis) {
    const { success } = await getLimiter(limit, Math.ceil(windowMs / 1000)).limit(
      key,
    );
    return success;
  }
  return memoryLimit(key, limit, windowMs);
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}
