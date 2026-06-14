import { prisma } from "@/lib/prisma";

// Idempotencia estilo Stripe para endpoints de dinero (header Idempotency-Key).
// Patrón claim-first: se reclama la key (unique) antes de actuar; un reintento
// con la misma key devuelve la respuesta guardada sin re-ejecutar.

export type Idempotent =
  | { kind: "replay"; statusCode: number; body: unknown }
  | { kind: "in_progress" }
  | {
      kind: "fresh";
      commit: (statusCode: number, body: unknown) => Promise<void>;
      release: () => Promise<void>;
    };

// Tras este lapso, un claim sin respuesta (statusCode null) se considera colgado
// (el proceso murió antes de commit/release) y otra request puede retomarlo. Sin
// esto, una key quedaría trabada para siempre devolviendo 409.
const STALE_CLAIM_MS = 60_000;

/**
 * Reclama una idempotency key dentro de un `scope` (ej. providerId).
 * - `replay`: ya se completó → devolver `statusCode`/`body` guardados.
 * - `in_progress`: otra request con la misma key está corriendo → 409.
 * - `fresh`: seguí; al terminar llamá `commit(...)` (éxito) o `release()` (error).
 */
export async function beginIdempotent(
  scope: string,
  key: string,
): Promise<Idempotent> {
  try {
    await prisma.idempotencyKey.create({ data: { scope, key } });
  } catch {
    // La key ya existe (unique): es un reintento.
    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (existing?.statusCode != null) {
      return {
        kind: "replay",
        statusCode: existing.statusCode,
        body: JSON.parse(existing.response ?? "null"),
      };
    }
    // Claim sin respuesta: ¿está vivo o colgado? Si superó el TTL, lo retomamos
    // (claim atómico por createdAt para no pisarnos con otra request que reintente
    // a la vez). Si no, sigue en curso.
    if (
      existing &&
      Date.now() - existing.createdAt.getTime() > STALE_CLAIM_MS
    ) {
      const takeover = await prisma.idempotencyKey.updateMany({
        where: { scope, key, statusCode: null, createdAt: existing.createdAt },
        data: { createdAt: new Date() },
      });
      if (takeover.count === 1) return freshHandle(scope, key);
    }
    return { kind: "in_progress" };
  }

  return freshHandle(scope, key);
}

/** Handlers de una key reclamada (recién creada o retomada por TTL). */
function freshHandle(scope: string, key: string): Idempotent {
  return {
    kind: "fresh",
    commit: async (statusCode, body) => {
      await prisma.idempotencyKey.update({
        where: { scope_key: { scope, key } },
        data: { statusCode, response: JSON.stringify(body) },
      });
    },
    release: async () => {
      await prisma.idempotencyKey
        .delete({ where: { scope_key: { scope, key } } })
        .catch(() => {});
    },
  };
}
