import { NWCClient, Nip47TimeoutError, Nip47NetworkError } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";
import * as Sentry from "@sentry/nextjs";

// Wallets NWC del store, en orden de preferencia. El primero es el primario; el
// segundo (opcional) es el fallback que se usa SÓLO si el primario falla al
// cobrar/pagar. Sirve para todo: cobrar apuestas, cobrar la venta de juegos y
// pagar premios/reembolsos. Configurar con:
//   NWC_CONNECTION_STRING           (primario, obligatorio para salir de modo dev)
//   NWC_CONNECTION_STRING_FALLBACK  (fallback, opcional)
const NWC_URLS = [
  process.env.NWC_CONNECTION_STRING,
  process.env.NWC_CONNECTION_STRING_FALLBACK,
].filter((u): u is string => Boolean(u));

/** ¿Hay al menos un wallet NWC configurado? Si no, el flujo corre en "modo dev". */
export function lightningConfigured(): boolean {
  return NWC_URLS.length > 0;
}

/**
 * ¿El próximo pago saldría por un wallet que NO es el primario? Es decir, el
 * primario está caído y un fallback va a cobrar el routing (ej. Rizful). Lo usa
 * la liquidación para reservar el sobrecosto de ruteo solo cuando corresponde.
 * Con un único wallet configurado no hay distinción de fallback → false.
 */
export function payoutsWillUseFallback(): boolean {
  if (NWC_URLS.length < 2) return false;
  return attemptOrder()[0] !== 0;
}

// Clientes NWC reutilizados entre llamadas (uno por wallet): la conexión al relay
// (WebSocket + handshake NWC) tarda segundos en abrirse, así que crear uno nuevo
// por cada consulta hacía que la detección del pago se sintiera muy lenta.
// Mantenemos las conexiones calientes y las compartimos.
const cachedClients: (NWCClient | null)[] = [];

function getClient(i: number): NWCClient {
  const url = NWC_URLS[i];
  if (!url) throw new Error(`Wallet NWC #${i} no configurado`);
  if (!cachedClients[i]) {
    cachedClients[i] = new NWCClient({ nostrWalletConnectUrl: url });
  }
  return cachedClients[i]!;
}

// ── Salud de wallets (failover rápido) ───────────────────────────────────────
// Un wallet NWC cuyo nodo perdió internet NO falla rápido: el relay sigue vivo y
// acepta el pedido, pero el wallet nunca publica respuesta, así que el SDK espera
// el `replyTimeout` (~60s) antes de lanzar. Si probáramos siempre el primario
// primero, pagaríamos ese peaje de ~60s en CADA operación mientras el nodo esté
// caído (crear invoice del depósito, cada poll de detección de pago, pagar el
// premio…), que es por qué una apuesta con el primario caído tardaba minutos.
//
// Para evitarlo marcamos el wallet como "caído" cuando una operación muere por
// timeout/red, y lo mandamos al fondo del orden de intentos: las siguientes
// llamadas prueban primero el wallet sano (el fallback) sin colgarse. En segundo
// plano lo re-sondeamos con un `get_info` liviano; cuando responde (volvió
// internet) lo reponemos al frente solo, sin intervención del operador.
const PROBE_INTERVAL_MS = 60_000; // mínimo entre re-sondeos de un wallet caído
const PROBE_TIMEOUT_MS = 12_000; // corte del sondeo (get_info ya corta a ~10s)
// Corte propio para operaciones rápidas (crear invoice, consultar pago). El SDK
// espera ~60s su `replyTimeout` antes de rendirse cuando el nodo no responde, y
// como el estado de salud arranca vacío tras cada deploy, el PRIMER pedido al
// primario caído pagaba esos 60s enteros antes de marcarlo y pasar al fallback.
// Con este corte ese primer descubrimiento tarda segundos. No lo aplicamos a
// `pay_invoice`: un pago real puede tardar por ruteo, y para entonces la salud ya
// sabe que el primario está caído (lo marcó el makeInvoice/lookup previo) y lo
// saltea por el reordenamiento.
const FAST_OP_TIMEOUT_MS = 8_000;

/** Timeout propio (más corto que el del SDK) para que el failover no se cuelgue. */
class WalletTimeoutError extends Error {}

// Wallet DEGRADADO: responde al relay (get_info OK, lookup OK) pero FALLA las
// operaciones que mueven plata — p. ej. `make_invoice` con LiquidityRequestFailed
// (sin liquidez entrante) o `pay_invoice` con PaymentSendingFailed (sin ruta o
// saldo). Son errores de aplicación, no timeouts, así que `isWalletDownError` no
// los ve y el sondeo get_info tampoco: sin este estado, CADA operación volvía a
// intentar primero el wallet enfermo y pagaba su error (~1-3s) antes de usar el
// sano. Un wallet degradado va al fondo del orden por este cooldown; lo repone
// una operación real exitosa (o el vencimiento, que habilita reintentarlo).
const DEGRADED_COOLDOWN_MS = 5 * 60_000;

type WalletHealth = {
  down: boolean;
  lastProbe: number;
  probing: boolean;
  degradedUntil: number;
};
const health: WalletHealth[] = NWC_URLS.map(() => ({
  down: false,
  lastProbe: 0,
  probing: false,
  degradedUntil: 0,
}));

function isDegraded(i: number): boolean {
  return Date.now() < health[i].degradedUntil;
}

function markDegraded(i: number, op: string): void {
  const yaEstaba = isDegraded(i);
  health[i].degradedUntil = Date.now() + DEGRADED_COOLDOWN_MS;
  if (!yaEstaba) {
    Sentry.captureMessage(
      `NWC wallet #${i} degradado (${op} falló): las próximas operaciones prueban primero el otro wallet`,
      "warning",
    );
  }
}

/** ¿El error indica que el wallet no respondió (caído), no que rechazó la operación? */
function isWalletDownError(err: unknown): boolean {
  return (
    err instanceof Nip47TimeoutError ||
    err instanceof Nip47NetworkError ||
    err instanceof WalletTimeoutError
  );
}

function markDown(i: number): void {
  if (!health[i].down) {
    health[i].down = true;
    Sentry.captureMessage(
      `NWC wallet #${i} marcado caído: failover al siguiente wallet`,
      "warning",
    );
  }
}

function markUp(i: number): void {
  if (health[i].down) {
    health[i].down = false;
    Sentry.captureMessage(`NWC wallet #${i} recuperado`, "info");
  }
}

/** Una operación que MUEVE plata salió bien: el wallet dejó de estar degradado. */
function markOpHealthy(i: number): void {
  if (isDegraded(i)) {
    Sentry.captureMessage(`NWC wallet #${i} recuperado (operación real exitosa)`, "info");
  }
  health[i].degradedUntil = 0;
}

/**
 * Índices de wallets en orden de intento: sanos primero (por preferencia), luego
 * degradados (responden pero fallan operaciones), caídos al final.
 */
function attemptOrder(): number[] {
  const rank = (i: number) => (health[i].down ? 2 : isDegraded(i) ? 1 : 0);
  return NWC_URLS.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new WalletTimeoutError(`timeout tras ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Pre-calienta los wallets al arrancar la instancia: abre la conexión NWC
 * (WebSocket + handshake, que tarda segundos) y sondea `get_info` para poblar el
 * estado de salud ANTES de la primera operación real. Sin esto, la primera
 * apuesta paga el handshake en frío y, si el primario está caído, el peaje de
 * descubrirlo (~8s de FAST_OP_TIMEOUT_MS) recién en el `makeInvoice` del depósito.
 * No bloquea el arranque ni lanza: se llama fire-and-forget desde instrumentation.
 */
export async function warmUpWallets(): Promise<void> {
  if (!lightningConfigured()) return;
  await Promise.allSettled(
    NWC_URLS.map((_, i) =>
      withTimeout(getClient(i).getInfo(), PROBE_TIMEOUT_MS).then(
        () => markUp(i),
        () => markDown(i), // caído desde el arranque → el failover ya lo saltea
      ),
    ),
  );
}

/**
 * Re-sondea en segundo plano los wallets marcados caídos (a lo sumo cada
 * `PROBE_INTERVAL_MS`). NO bloquea la operación en curso: si el `get_info`
 * responde, el wallet volvió y lo reponemos al frente para la próxima llamada.
 */
function probeDownWallets(): void {
  const now = Date.now();
  for (let i = 0; i < NWC_URLS.length; i++) {
    const h = health[i];
    if (!h.down || h.probing || now - h.lastProbe < PROBE_INTERVAL_MS) continue;
    h.probing = true;
    h.lastProbe = now;
    withTimeout(getClient(i).getInfo(), PROBE_TIMEOUT_MS)
      .then(() => markUp(i))
      .catch(() => {}) // sigue caído: queda al fondo del orden
      .finally(() => {
        h.probing = false;
      });
  }
}

/**
 * Ejecuta una operación de cobro/pago probando los wallets en orden de salud
 * (sano primero, caído al final). Devuelve el resultado del primero que responda
 * OK. Si todos fallan, propaga el último error. Un wallet que muere por timeout/red
 * se marca caído para que las próximas llamadas no se cuelguen con él.
 *
 * IMPORTANTE para pagos: quien llame con un invoice/bolt11 ya emitido debe
 * mantenerlo fijo entre reintentos (no pedir uno nuevo por wallet). Así, si un
 * wallet ya pagó pero la respuesta se perdió, el siguiente intenta el MISMO
 * invoice y la red lo rechaza por "ya pagado" en vez de pagar dos veces.
 */
async function withFailover<T>(
  op: string,
  fn: (client: NWCClient) => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  probeDownWallets();
  let lastErr: unknown;
  const orden = attemptOrder();
  for (let k = 0; k < orden.length; k++) {
    const i = orden[k];
    try {
      const call = fn(getClient(i));
      const result = await (timeoutMs ? withTimeout(call, timeoutMs) : call);
      markUp(i);
      markOpHealthy(i);
      if (k > 0) {
        // No salió el wallet preferido: avisar para que el operador lo revise
        // (puede estar caído o sin saldo).
        Sentry.captureMessage(
          `NWC ${op}: se usó el wallet #${i} (el preferido falló o está caído)`,
          "warning",
        );
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (isWalletDownError(err)) {
        markDown(i);
      } else {
        // Error de APLICACIÓN del wallet (LiquidityRequestFailed, PaymentSendingFailed,
        // saldo insuficiente…): withFailover solo corre operaciones que mueven plata
        // (make_invoice / pay_invoice), así que un rechazo acá = wallet degradado. Si
        // el fallo fuera del destino (no del wallet), el siguiente wallet también va a
        // fallar y quedar degradado — el orden relativo no empeora.
        markDegraded(i, op);
      }
      const hayMas = k < orden.length - 1;
      Sentry.captureException(err, {
        level: hayMas ? "warning" : "error",
        tags: { flow: "nwc-failover", op, wallet: i },
      });
    }
  }
  throw lastErr;
}

export type CreatedInvoice = {
  invoice: string; // bolt11
  paymentHash: string;
  expiresAt: number; // unix seconds
};

/** Crea un invoice para cobrar `amountSats` (NWC usa msat). */
export async function createInvoice(
  amountSats: number,
  description: string,
): Promise<CreatedInvoice> {
  return createInvoiceFromNwc(amountSats * 1000, { description });
}

/**
 * Crea un invoice cuyo BOLT11 compromete el hash SHA-256 de una descripcion
 * externa. NIP-57 exige este formato para los recibos kind:9735.
 */
export async function createDescriptionHashInvoice(
  amountSats: number,
  descriptionHash: string,
): Promise<CreatedInvoice> {
  return createDescriptionHashInvoiceMsat(amountSats * 1000, descriptionHash);
}

/**
 * Igual que `createDescriptionHashInvoice` pero con el monto en msat exacto (sin
 * pasar por sats), para LNURL-pay donde el monto pedido llega en msat y el invoice
 * debe cobrar EXACTAMENTE eso. Acepta cualquier msat entero (ej. depósito libre).
 */
export async function createDescriptionHashInvoiceMsat(
  amountMsat: number,
  descriptionHash: string,
): Promise<CreatedInvoice> {
  if (!/^[a-f0-9]{64}$/i.test(descriptionHash)) {
    throw new Error("descriptionHash debe ser un SHA-256 hexadecimal");
  }
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    throw new Error("El monto debe ser un entero positivo de msat");
  }
  return createInvoiceFromNwc(amountMsat, {
    description_hash: descriptionHash.toLowerCase(),
  });
}

async function createInvoiceFromNwc(
  amountMsat: number,
  description:
    | { description: string }
    | { description_hash: string },
): Promise<CreatedInvoice> {
  return withFailover(
    "makeInvoice",
    async (client) => {
      const tx = await client.makeInvoice({
        amount: amountMsat,
        ...description,
        expiry: 60 * 15,
      });
      return {
        invoice: tx.invoice,
        paymentHash: tx.payment_hash,
        expiresAt: tx.expires_at,
      };
    },
    FAST_OP_TIMEOUT_MS,
  );
}

/**
 * Saldo total (en sats) sumando los wallets NWC que respondan. Es para mostrarle al
 * admin cuánto hay en la tesorería; nunca lanza (devuelve null si no hay wallet
 * configurado o si ninguno respondió). Un wallet caído se saltea (y se marca down).
 */
export async function getWalletBalanceSats(): Promise<number | null> {
  if (!lightningConfigured()) return null;
  probeDownWallets();
  let totalMsat = 0;
  let algunoRespondio = false;
  for (const i of attemptOrder()) {
    try {
      const res = await withTimeout(getClient(i).getBalance(), FAST_OP_TIMEOUT_MS);
      markUp(i);
      totalMsat += res.balance ?? 0;
      algunoRespondio = true;
    } catch (err) {
      if (isWalletDownError(err)) markDown(i);
    }
  }
  return algunoRespondio ? Math.floor(totalMsat / 1000) : null;
}

/**
 * ¿Está pagado el invoice con este `paymentHash`?
 *
 * Como el cobro pudo haber hecho failover al fallback, no sabemos a priori qué
 * wallet emitió este invoice. Consultamos TODOS los wallets y devolvemos `true`
 * si cualquiera lo da por liquidado. Un wallet que no conoce el invoice lanza
 * (NOT_FOUND) y simplemente probamos el siguiente. Sólo propagamos error si
 * NINGÚN wallet respondió (todos caídos): así no confundimos "wallet offline"
 * con "no pagado".
 */
export async function isInvoicePaid(paymentHash: string): Promise<boolean> {
  probeDownWallets();
  let lastErr: unknown;
  let algunoRespondio = false;
  // Dos pasadas: primero los wallets sanos; sólo si NINGUNO conoce el invoice
  // (p. ej. lo emitió el wallet que ahora está caído) tocamos los caídos, que
  // pueden colgarse hasta el timeout. Durante una caída del primario los invoices
  // los emite el fallback (sano), así que el caso normal nunca toca el caído.
  for (const soloSanos of [true, false]) {
    for (const i of attemptOrder()) {
      if (health[i].down === soloSanos) continue; // 1ª pasada: sanos; 2ª: sólo caídos
      try {
        const tx = await withTimeout(
          getClient(i).lookupInvoice({ payment_hash: paymentHash }),
          FAST_OP_TIMEOUT_MS,
        );
        markUp(i);
        algunoRespondio = true;
        // El wallet que conoce el invoice es el que lo emitió: su respuesta es la
        // única autoritativa. Devolvemos ya (pagado o no) en vez de gastar otra
        // vuelta preguntándole al resto, que solo puede contestar NOT_FOUND.
        return tx.state === "settled";
      } catch (err) {
        // Este wallet no conoce el invoice o está caído: probamos el siguiente.
        lastErr = err;
        if (isWalletDownError(err)) markDown(i);
      }
    }
  }
  if (!algunoRespondio) throw lastErr;
  return false;
}

/** Paga `amountSats` a una Lightning Address. Devuelve el preimage. */
export async function payToLightningAddress(
  lightningAddress: string,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const la = new LightningAddress(lightningAddress);
  await la.fetch();
  // Pedimos el invoice UNA vez, fuera del failover: si el primario ya lo pagó
  // pero falló al responder, el fallback intenta el mismo bolt11 (idempotente).
  const invoice = await la.requestInvoice({ satoshi: amountSats, comment });
  return withFailover("payInvoice", async (client) => {
    const res = await client.payInvoice({ invoice: invoice.paymentRequest });
    return res.preimage;
  });
}

/** Paga un invoice bolt11 ya provisto (ej. LNURL-withdraw). Devuelve el preimage. */
export async function payInvoiceRaw(bolt11: string): Promise<string> {
  return withFailover("payInvoice", async (client) => {
    const res = await client.payInvoice({ invoice: bolt11 });
    return res.preimage;
  });
}
