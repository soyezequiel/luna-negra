import { prisma } from "@/lib/prisma";
import { fetchProfile } from "@/lib/nostr";
import { pubkeyFromNpub } from "@/lib/escrow";
import { inspectZapEndpoint } from "@/lib/zap";

// Chequeo de "aptitud para recibir zaps" de un usuario: ¿el pago que Luna Negra le
// haría al ganar una apuesta puede salir como zap social NIP-57 (recibo 9735
// público) o va a caer a QR/LNURL sin recibo? Replica la MISMA cascada de destino
// de los payouts (ver resolveDestination en escrow-payout.ts) y encima sondea el
// LNURL (inspectZapEndpoint) para dar un veredicto con pasos concretos de guía.
// Lo consume la tarjeta de /profile/editar y la API /api/me/zap-readiness.

export type ZapReadinessStatus =
  | "ready" // apto: dirección con soporte NIP-57
  | "nwc_selected" // eligió cobrar por NWC (QR), no genera zap social
  | "no_address" // no tiene Lightning Address ni en Luna Negra ni en el perfil
  | "bad_address" // la dirección no tiene formato válido
  | "unreachable" // no se pudo contactar el servidor de la dirección
  | "no_nip57"; // la dirección cobra, pero su wallet no anuncia zaps NIP-57

export type ZapReadiness = {
  ready: boolean;
  status: ZapReadinessStatus;
  /** Dirección efectiva evaluada (de Luna Negra o del perfil Nostr), o null. */
  address: string | null;
  /** De dónde salió la dirección evaluada. */
  source: "config" | "profile" | "probe" | null;
  /** Método de cobro elegido por el usuario. */
  payoutMethod: "address" | "nwc" | null;
  /** Pubkey que firmaría el recibo 9735 (solo si es apto). */
  nostrPubkey: string | null;
  title: string;
  reason: string;
  /** Pasos concretos para volverse apto (vacío si ya lo es). */
  steps: string[];
};

const WALLETS =
  "Alby, Primal, Wallet of Satoshi, Coinos o LNbits (con la extensión Nostr Zaps)";

type BuildCtx = {
  address: string | null;
  source: ZapReadiness["source"];
  payoutMethod: ZapReadiness["payoutMethod"];
  nostrPubkey?: string | null;
  /** Para nwc_selected: si la dirección que tiene ya soportaría zaps. */
  addressReady?: boolean;
};

function build(status: ZapReadinessStatus, ctx: BuildCtx): ZapReadiness {
  const base = {
    address: ctx.address,
    source: ctx.source,
    payoutMethod: ctx.payoutMethod,
    nostrPubkey: ctx.nostrPubkey ?? null,
  };
  switch (status) {
    case "ready":
      return {
        ...base,
        ready: true,
        status,
        title: "Apto para recibir zaps ✓",
        reason:
          "Tu Lightning Address soporta zaps NIP-57. Cuando ganes una apuesta, el " +
          "pago va a salir como zap social con recibo público en Nostr.",
        steps: [],
      };
    case "nwc_selected":
      return {
        ...base,
        ready: false,
        status,
        title: "Vas a cobrar por QR, no por zap",
        reason:
          "Elegiste “Mi wallet NWC” como destino de cobros. Los premios por NWC se " +
          "reclaman con un QR y no generan un zap social visible en Nostr.",
        steps: [
          "Entrá a “Destino de cobros” y elegí “Dirección Lightning”.",
          ctx.addressReady
            ? `Tu dirección ${ctx.address} ya soporta zaps: con ese cambio quedás apto.`
            : `Configurá una Lightning Address con soporte de zaps (${WALLETS}).`,
        ],
      };
    case "no_address":
      return {
        ...base,
        ready: false,
        status,
        title: "Falta tu Lightning Address",
        reason:
          "No encontramos una Lightning Address tuya ni en Luna Negra ni en tu perfil " +
          "Nostr, así que no hay a dónde mandar el zap.",
        steps: [
          "Agregá tu Lightning Address (ej. usuario@walletofsatoshi.com).",
          `Usá un wallet que soporte zaps NIP-57 (${WALLETS}).`,
        ],
      };
    case "bad_address":
      return {
        ...base,
        ready: false,
        status,
        title: "La dirección no es válida",
        reason:
          "La dirección configurada no tiene el formato de una Lightning Address " +
          "(debería ser usuario@dominio).",
        steps: [
          "Revisá que sea del tipo usuario@dominio.com.",
          "Corregila y volvé a verificar.",
        ],
      };
    case "unreachable":
      return {
        ...base,
        ready: false,
        status,
        title: "No pudimos contactar tu wallet",
        reason:
          "El servidor de tu Lightning Address no respondió. Puede ser algo temporal.",
        steps: [
          "Probá de nuevo en un momento.",
          "Verificá que la dirección esté bien escrita y que el wallet esté activo.",
        ],
      };
    case "no_nip57":
      return {
        ...base,
        ready: false,
        status,
        title: "Tu wallet no soporta zaps",
        reason:
          "Tu Lightning Address sirve para cobrar, pero su servidor no anuncia soporte " +
          "de zaps NIP-57 (allowsNostr), así que el pago no aparece como zap social.",
        steps: [
          `Cambiá a un wallet con zaps NIP-57 (${WALLETS}).`,
          "Actualizá tu Lightning Address y volvé a verificar.",
        ],
      };
  }
}

/** Mapea el sondeo del LNURL a un `ZapReadiness` (para una dirección concreta). */
async function readinessForAddress(
  address: string,
  source: ZapReadiness["source"],
  payoutMethod: ZapReadiness["payoutMethod"],
): Promise<ZapReadiness> {
  const inspection = await inspectZapEndpoint(address);
  if (inspection.ok) {
    return build("ready", {
      address,
      source,
      payoutMethod,
      nostrPubkey: inspection.endpoint.nostrPubkey,
    });
  }
  return build(inspection.reason, { address, source, payoutMethod });
}

/**
 * Prueba una dirección candidata sin tocar la DB (para el input "probar otra
 * dirección" antes de guardarla).
 */
export async function checkAddressReadiness(address: string): Promise<ZapReadiness> {
  return readinessForAddress(address.trim().toLowerCase(), "probe", null);
}

/**
 * Veredicto de aptitud del usuario logueado: resuelve su destino real (método +
 * cascada config→perfil) y lo sondea. Nunca lanza (los fallos de red caen a
 * `unreachable`).
 */
export async function checkZapReadiness(opts: {
  npub: string;
  pubkey?: string | null;
}): Promise<ZapReadiness> {
  try {
    const user = await prisma.user
      .findUnique({
        where: { npub: opts.npub },
        select: { lud16: true, payoutMethod: true },
      })
      .catch(() => null);

    const isNwc = user?.payoutMethod === "nwc";
    const method: "address" | "nwc" = isNwc ? "nwc" : "address";

    // Cascada de destino (idéntica a resolveDestination): lud16 en Luna Negra →
    // lud16 del perfil Nostr (kind:0).
    let address = user?.lud16 ?? null;
    let source: ZapReadiness["source"] = address ? "config" : null;
    if (!address) {
      const pk = opts.pubkey ?? pubkeyFromNpub(opts.npub);
      if (pk) {
        const profile = await fetchProfile(pk).catch(() => null);
        if (profile?.lud16) {
          address = profile.lud16;
          source = "profile";
        }
      }
    }

    // Cobra por NWC: el payout sale por QR (resolveDestination devuelve null),
    // nunca como zap. Igual sondeamos su dirección para poder decirle que, con solo
    // cambiar el método, quedaría apto.
    if (isNwc) {
      const addressReady = address
        ? (await inspectZapEndpoint(address)).ok
        : false;
      return build("nwc_selected", {
        address,
        source,
        payoutMethod: method,
        addressReady,
      });
    }

    if (!address) {
      return build("no_address", { address: null, source: null, payoutMethod: method });
    }
    return readinessForAddress(address, source, method);
  } catch {
    return build("unreachable", { address: null, source: null, payoutMethod: null });
  }
}
