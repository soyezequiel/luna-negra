// Rate-limiter simple en memoria (ventana fija).
// NOTA: la memoria NO se comparte entre instancias serverless, así que esto es
// un guard básico. Para producción real usar Upstash/Redis (@upstash/ratelimit).

type Hit = { count: number; reset: number };
const store = new Map<string, Hit>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
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

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}
