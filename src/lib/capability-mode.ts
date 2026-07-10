// Migración por capacidad de la interfaz Luna dependiente (REST) a la interfaz
// NGP. Un proveedor puede pasar CADA capacidad "intermedia" de su
// juego a Nostr; al hacerlo, la pata Luna (REST) de esa capacidad se APAGA para
// ese juego (el endpoint devuelve 409). Sirve para migrar de a poco sin cortar
// todo de golpe. Persistido en Game.capsMode (JSON { [capKey]: "luna" | "nostr" }).

// Solo estas 4 capacidades son migrables: son las de la columna intermedia cuyo
// reemplazo Nostr YA funciona (login NIP-07/46, marcador kind:31339, presencia
// NIP-38, apuestas por zaps NIP-57). Salas e invitaciones quedan afuera porque su
// lado Nostr todavía es diseño: migrarlas apagaría la pata Luna sin reemplazo.
// Las claves son las de CapabilityRow.key en src/lib/integration-ngp.ts.
export const MIGRATABLE_CAPS = ["identidad", "marcador", "presencia", "bets"] as const;
export type MigratableCap = (typeof MIGRATABLE_CAPS)[number];

export type CapMode = "luna" | "nostr";

export function isMigratableCap(key: string): key is MigratableCap {
  return (MIGRATABLE_CAPS as readonly string[]).includes(key);
}

// "Verificar compra" (§2) NO tiene equivalente Nostr: Luna es la custodia/vendedora,
// así que no se migra, se DESACTIVA. Desactivada = acceso abierto: el juego deja de
// requerir compra y GET /api/v1/entitlements/verify responde valid:true (bypassed)
// para cualquiera. Se guarda en el mismo Game.capsMode bajo la clave "purchase" con
// valores "on" (default, verificación activa) | "off" (acceso abierto).
export const PURCHASE_CAP = "purchase";
export type PurchaseMode = "on" | "off";

export function purchaseMode(capsMode: unknown): PurchaseMode {
  if (capsMode && typeof capsMode === "object" && !Array.isArray(capsMode)) {
    if ((capsMode as Record<string, unknown>)[PURCHASE_CAP] === "off") return "off";
  }
  return "on";
}

// ¿La verificación de compra está desactivada (acceso abierto) para este juego?
export function purchaseVerificationDisabled(capsMode: unknown): boolean {
  return purchaseMode(capsMode) === "off";
}

// Lee el modo de una capacidad desde un valor Game.capsMode ya cargado. Ausente o
// cualquier cosa que no sea "nostr" = "luna" (default retrocompatible). Acepta
// cualquier string por comodidad del cliente (una clave no migrable → "luna").
export function capMode(capsMode: unknown, key: string): CapMode {
  if (capsMode && typeof capsMode === "object" && !Array.isArray(capsMode)) {
    if ((capsMode as Record<string, unknown>)[key] === "nostr") return "nostr";
  }
  return "luna";
}
