// Cascada de DESTINO de un payout (lud16 / QR de retiro) — módulo neutral,
// compartido por los dos motores de apuestas (v1 escrow-payout.ts y v2
// escrow-v2-payout.ts / zap-bet.ts). Vivía en escrow-payout.ts (v1); se extrajo
// para que v2 no dependa de un módulo v1 y el retiro de v1 sea un borrado limpio.

import { prisma } from "@/lib/prisma";
import { fetchProfile } from "@/lib/nostr";
import { pubkeyFromNpub } from "@/lib/escrow";

// Tope de espera al leer el kind:0 en el camino de PAGO: querySync espera el EOSE
// de TODOS los relays (~4,4s si uno está lento/colgado), y este lookup corre en
// línea dentro de la liquidación — es latencia directa entre "ganaste" y "te
// llegó el zap". Con el tope, un relay lento sólo puede costar esto; el fallback
// (User.lud16 / QR de retiro) cubre si ningún relay llegó a responder.
const PAYOUT_PROFILE_MAX_WAIT_MS = 3_000;

// Caché en memoria del lud16 del perfil (pubkey → lud16|null) para NO tocar relays
// en el momento de pagar: se precalienta al fondearse la apuesta (ver
// prewarmPayoutDestinations) y la liquidación lo lee al instante. TTL corto: si la
// partida dura más, la liquidación paga a lo sumo el fetch con tope de arriba.
// En globalThis a propósito: Turbopack duplica este módulo en varios chunks del
// server (la ruta que fondea y la que liquida pueden ser instancias distintas);
// un Map top-level dejaría el precalentado en una copia y la liquidación leería
// otra vacía.
const PROFILE_LUD16_TTL_MS = 15 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var lunaProfileLud16Cache: Map<string, { lud16: string | null; at: number }> | undefined;
}
const profileLud16Cache = (globalThis.lunaProfileLud16Cache ??= new Map());

/** lud16 del kind:0 (con caché + tope de espera). null = perfil sin lud16 o relays mudos. */
async function profileLud16For(pubkey: string): Promise<string | null> {
  const hit = profileLud16Cache.get(pubkey);
  if (hit && Date.now() - hit.at < PROFILE_LUD16_TTL_MS) return hit.lud16;
  const profile = await fetchProfile(pubkey, { maxWaitMs: PAYOUT_PROFILE_MAX_WAIT_MS }).catch(
    () => null,
  );
  const lud16 = profile?.lud16 ?? null;
  // No cachear el fallo total (profile null): pudo ser un parpadeo de relays y
  // cachearlo forzaría 15 min de QR de retiro para un usuario que sí tiene lud16.
  if (profile) profileLud16Cache.set(pubkey, { lud16, at: Date.now() });
  return lud16;
}

/**
 * Precalienta el destino de payout de cada participante (lee su kind:0 y cachea el
 * lud16). Se dispara al quedar FONDEADA la apuesta, así la liquidación —que corre
 * en línea cuando el juego reporta al ganador— no espera a los relays para pagar.
 * Fire-and-forget: nunca lanza ni bloquea al caller.
 */
export function prewarmPayoutDestinations(npubs: string[]): void {
  for (const npub of npubs) {
    const pk = pubkeyFromNpub(npub);
    if (pk) void profileLud16For(pk).catch(() => {});
  }
}

/**
 * Cascada de destino (R5): lud16 configurado en Luna Negra (perfil) →
 * lud16 del perfil Nostr (kind:0). Si no hay → null (fallback a QR de retiro).
 *
 * Si el usuario eligió cobrar a su wallet NWC (`payoutMethod === "nwc"`),
 * devolvemos null a propósito: el secreto NWC vive sólo en su navegador, así que
 * forzamos `withdraw_pending` y el cliente reclama el premio por LNURL-withdraw.
 */
export async function resolveDestination(npub: string): Promise<string | null> {
  const user = await prisma.user
    .findUnique({ where: { npub }, select: { lud16: true, payoutMethod: true } })
    .catch(() => null);
  if (user?.payoutMethod === "nwc") return null;
  if (user?.lud16) return user.lud16;

  const pk = pubkeyFromNpub(npub);
  if (!pk) return null;
  return profileLud16For(pk);
}

/**
 * Destino para un payout-ZAP (v2), optimizado para VISIBILIDAD social.
 *
 * Un zap sólo se renderiza en la nota/perfil del destinatario si el recibo (9735)
 * está firmado por el `nostrPubkey` que anuncia el lud16 de SU PERFIL (kind:0)
 * — es la regla de verificación de NIP-57. Por eso, al revés que `resolveDestination`
 * (que prioriza el `User.lud16` configurado en Luna, pensado para cobros no-sociales
 * como el QR de retiro), acá preferimos el lud16 del perfil Nostr: así el zap del
 * premio queda anclado a una dirección que el cliente puede verificar y mostrar.
 *
 * Cascada: NWC → null (retiro por QR; el secreto vive sólo en el navegador) →
 * lud16 del perfil (kind:0) → `User.lud16` (paga igual, aunque el zap podría no
 * renderizar como verificado) → null (QR).
 */
export async function resolveZapDestination(npub: string): Promise<string | null> {
  const user = await prisma.user
    .findUnique({ where: { npub }, select: { lud16: true, payoutMethod: true } })
    .catch(() => null);
  if (user?.payoutMethod === "nwc") return null;

  const pk = pubkeyFromNpub(npub);
  const profileLud16 = pk ? await profileLud16For(pk) : null;
  return profileLud16 ?? user?.lud16 ?? null;
}
