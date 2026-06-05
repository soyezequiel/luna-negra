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
    return { kind: "in_progress" };
  }

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
