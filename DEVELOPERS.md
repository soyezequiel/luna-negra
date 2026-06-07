# Integrar tu juego con Luna Negra

Tutorial completo para desarrolladores. **Vos hosteás tu juego donde quieras**;
Luna Negra aporta visibilidad, identidad (Nostr), cobros en Lightning, multijugador,
apuestas con escrow y webhooks — todo vía una API estándar.

> 📖 **Referencia interactiva (OpenAPI):** `/developers` · spec en `/openapi.json`
> 📦 **SDK de TypeScript:** [`sdk/`](sdk/) (`@lunanegra/sdk`)
> 🎮 **Ejemplo funcionando:** [`public/demo-game/index.html`](public/demo-game/index.html)

---

## Cómo funciona (modelo mental)

```
Jugador  ──compra/juega──►  Luna Negra  ──token / webhook──►  Tu juego (lo hosteás vos)
                              (tienda)                          (consumís la API)
```

- La **identidad** del jugador es su **npub** (Nostr). Luna Negra maneja el login;
  tu juego solo recibe el npub ya verificado dentro de un token.
- Luna Negra **cobra** al jugador y te paga tu parte (por defecto **70%**) a tu
  Lightning Address.
- Tu juego **consume tokens y webhooks** para saber quién compró, quién se une a una
  sala y cómo resolver apuestas.

### Conceptos clave
| Concepto | Qué es |
|---|---|
| **npub** | Identidad Nostr del jugador (pública). |
| **entitlement token** | JWT corto que prueba que el jugador tiene acceso a tu juego. |
| **invite token** | JWT que prueba que un jugador puede unirse a una sala multijugador. |
| **API key** (`ln_sk_…`) | Credencial server-to-server de tu proveedor (crear apuestas). |
| **webhook secret** (`whsec_…`) | Secreto para verificar la firma de los webhooks. |

### Convenciones de la API (v1)
- **Base URL:** `https://<LUNA_NEGRA>` (tu deploy, ej. `luna-negra-three.vercel.app`).
- **Auth:** siempre `Authorization: Bearer <token-o-api-key>`.
- **Errores:** `{ "error": { "code": "…", "message": "…" } }` + status HTTP correcto.
- **CORS** habilitado en los endpoints públicos.

### SDK (recomendado)
El SDK te ahorra escribir `fetch`/JWT a mano:
```bash
npm i jose          # peer dependency
# copiá sdk/index.ts a tu proyecto (o instalá @lunanegra/sdk cuando esté publicado)
```
```ts
import { createClient } from "@lunanegra/sdk";
const luna = createClient({ baseUrl: "https://<LUNA_NEGRA>", apiKey: "ln_sk_…" });
```

---

## Paso 1 · Publicá tu juego
En el panel **/provider** (login con tu extensión Nostr nos2x/Alby):
1. Creá tu **perfil de proveedor** con tu **Lightning Address** (ahí cobrás).
2. Creá un juego: título, descripción, **precio en sats**, categoría y la **URL de tu
   juego** (`gameUrl`).
3. **Enviar a revisión** → un admin lo aprueba y queda publicado en la tienda.

## Paso 2 · Cobros (no integrás nada)
Cuando un jugador compra, Luna Negra cobra el total por Lightning y te transfiere tu
parte automáticamente, en sats. Para enterarte por código, usá el webhook
`purchase.completed` (Paso 6).

## Paso 3 · Verificá el acceso (entitlements)
Cuando el jugador toca **Jugar**, Luna Negra abre tu `gameUrl` con un token en la
query:
```
https://tu-juego.com/?lnToken=<JWT>
```

### Opción A — Verificación OFFLINE (recomendada)
El token es un **JWT ES256**. Validalo localmente con la clave pública del JWKS, sin
llamar a Luna Negra. Con el SDK:
```ts
const ent = await luna.verifyAccess(token);   // del ?lnToken=
if (!ent) return block();                       // inválido/expirado
console.log("acceso:", ent.npub, ent.gameId, ent.slug);
```
A mano (con `jose`):
```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
const JWKS = createRemoteJWKSet(new URL("https://<LUNA_NEGRA>/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: "luna-negra",
  audience: "lunanegra:game",
});
if (payload.scope !== "entitlement") throw new Error("token equivocado");
```
> Claims: `iss`, `aud` (`lunanegra:game`), `sub` (npub), `exp` (5 min), `scope`.

### Opción B — Verificación por endpoint (más simple)
Si no querés verificar JWT vos mismo:
```
GET https://<LUNA_NEGRA>/api/v1/entitlements/verify
Authorization: Bearer <lnToken>
→ 200 { "valid": true, "npub": "…", "gameId": "…", "slug": "…" }
→ 200 { "valid": false }     // inválido/expirado
```

> Verificá el token **en tu backend** antes de servir contenido pago. En el cliente
> solo para UX. Juegos gratis: `verifyAccess` igual devuelve el entitlement.

## Paso 4 · Multijugador / jugar con amigos
Luna Negra emite **invite tokens** de sala; **vos hosteás el lobby** (WebSocket) y
validás a quien se une:
```ts
const room = await luna.verifyRoom(inviteToken);   // del ?inviteToken=&room=
if (!room || room.roomId !== expectedRoom) return reject();

// Identidad ESTABLE del jugador: usá npub/pubkey como playerId, nunca un UUID local.
const playerId = room.pubkey;
const esHost = room.host;                  // creó la sala
const hostReal = room.hostNpub;            // quién es el host original (para invitados)

// Nombre/avatar NO viajan en el token (verifyRoom es offline). Refrescalos para la UI:
const perfil = await luna.getPlayerProfile(room.npub);
console.log(playerId, perfil?.displayName ?? "(sin nombre)", esHost ? "(host)" : `host: ${hostReal}`);
```
O por endpoint: `GET /api/v1/rooms/verify` con `Authorization: Bearer <inviteToken>`
→ `{ valid, npub, pubkey, displayName, avatarUrl, gameId, slug, roomId, host, hostNpub, hostPubkey, expiresAt }`.
Este endpoint sí incluye `displayName`/`avatarUrl` (cache kind:0); el SDK offline los deja en `null`.

- `npub`/`pubkey` = identidad **estable** (tu `playerId`); no generes UUIDs locales.
- `displayName`/`avatarUrl` son **solo presentación** (pueden ser `null`); refrescables con
  `GET /api/v1/players/:npub/profile` → `{ npub, pubkey, displayName, avatarUrl }`.
- `hostNpub`/`hostPubkey` dejan que los invitados sepan quién es el host real.
- `expiresAt` (ISO 8601) permite mostrar un error claro cuando la invitación expiró.

Flujo completo (crear sala, descubrir por Nostr, contrato del lobby) en
[`docs/multijugador-contrato.md`](docs/multijugador-contrato.md).

## Paso 5 · Apuestas / escrow
Tu game server crea apuestas y Luna Negra **custodia el pozo** y paga a los
ganadores (menos un fee configurable). Necesitás una **API key** (panel /provider →
"Claves de API"; se muestra una sola vez).

**Crear una apuesta** (pozo "winner-takes-all"):
```ts
const bet = await luna.createBet({
  gameId: "…",
  participants: ["npub1…", "npub1…"],   // ≥2, usuarios de Luna Negra
  stakeSats: 10,
  victoryCondition: "primero en llegar a 100",
  roomId: "sala-123",                    // opcional: correlación con tu sala
  metadata: { matchId: "m-42" },          // opcional: objeto libre
});
// bet.betId, bet.contractEventId, bet.depositDeadline
// + economía: bet.stakeSats, bet.potTargetSats, bet.feePct, bet.feeBps,
//   bet.feeSats, bet.netPayoutSats
```
Equivalente HTTP: `POST /api/v1/bets` con `Authorization: Bearer ln_sk_…`.
> **Reintentos seguros:** mandá `Idempotency-Key: <único>` — reintentar con la misma
> key devuelve la respuesta original **sin crear otra apuesta**.
> **Límites de stake:** `stakeSats` debe estar entre `minStakeSats` y `maxStakeSats`
> (beta: 5–100 sats, configurable). Fuera de rango → error `STAKE_OUT_OF_RANGE` (400).

**Cómo deposita cada jugador (escrow).** Cada participante paga su stake al pozo.
Pedí los handles de pago y entregáselos a cada jugador:
```ts
const dep = await luna.getBetDeposits(bet.betId);
// dep.deposits[i] = { npub, depositStatus, bolt11, lnurl, payUrl }
//   bolt11 → invoice Lightning fijo (= stake)
//   lnurl  → LNURL-pay (bech32) equivalente, para wallets
//   payUrl → deep-link a la pantalla de pago de Luna Negra (el jugador entra y paga)
// dep.potSats / dep.potTargetSats / dep.depositsReceived / dep.depositsTotal
```
Equivalente HTTP: `GET /api/v1/bets/{betId}/deposits` (Bearer API key).
- **`depositDeadline`** es el plazo para completar **todos** los depósitos. Si vence
  sin que el pozo esté completo, Luna Negra **reembolsa** lo depositado y cancela la
  apuesta (webhooks `bet.expired` + `bet.refunded`). Los handles vuelven `null` cuando
  el depósito ya cerró (pagado, vencido o estado no abierto).
- Cuando **todos** depositan, la apuesta pasa a `funded` (webhook `bet.funded`, alias
  `bet.ready`) y queda lista para resolverse.

**Consultar el estado** en cualquier momento:
```ts
const b = await luna.getBet(bet.betId);
// b.status: "pending_deposits" | "funded" | "settled" | "cancelled" | "expired" | "refunded"
// b.participants[i].depositStatus, b.potSats, b.feeSats, b.netPayoutSats, b.metadata…
```
Equivalente HTTP: `GET /api/v1/bets/{betId}` (Bearer API key).

**Reportar el resultado** — con tu API key, **no necesitás tocar Nostr**. Luna
Negra firma el resultado con tu **oráculo gestionado** (una clave Nostr que Luna
Negra genera y custodia por proveedor; solo se expone su pubkey):
```ts
await luna.reportWinners(bet.betId, ["npub1ganador…"]);   // ganadores por npub
await luna.reportWinners(bet.betId, []);                   // [] = empate/anulación → reembolso
```
Equivalente HTTP: `POST /api/v1/bets/{betId}/result` con `Authorization: Bearer ln_sk_…`
y body `{ "winners": ["npub1…"] }`.

<details><summary><b>Avanzado:</b> firmar el resultado vos mismo (self-sign)</summary>

Si preferís ser tu propio oráculo, firmá el evento con **tu clave de oráculo** y
posteá el evento firmado. La firma se valida contra tu `oraclePubkey` (NO contra
la clave con la que entrás a /provider). Para usar tu propia clave, rotá el
oráculo a tu pubkey desde /provider.
```ts
const evt = luna.buildResultEvent(bet.betId, ["npub1ganador…"]);
const signed = finalizeEvent(evt, miClaveDeOraculo);   // lo firmás vos (nostr-tools)
await luna.reportResult(bet.betId, signed);
```
Equivalente HTTP: `POST /api/v1/bets/{betId}/result` con `{ "event": <firmado> }`.
</details>

- **Un ganador:** se lleva el pozo menos la comisión (`netPayoutSats`).
- **Varios ganadores** (tags `winner` múltiples): el neto se **divide en partes
  iguales**; el resto indivisible (sub-msat) lo retiene la casa con la comisión.
- **Sin ganadores** (array vacío) ⇒ **empate/anulación**: se **reembolsa el stake
  completo a cada participante, sin comisión** (estado `refunded`, webhook
  `bet.refunded` con `reason: "void"`).

**Cancelar** una apuesta no resuelta (reembolsa los depósitos confirmados):
```ts
await luna.cancelBet(bet.betId);   // POST /api/v1/bets/{betId}/cancel (Bearer API key)
```
Emite `bet.cancelled` + `bet.refunded`. Solo se puede cancelar en `pending_deposits`
o `funded` (no después de resolverse): si no, error `CANNOT_CANCEL` / `ALREADY_RESOLVED`.

> 🔒 **Confianza:** el contrato (stake, fee, participantes) se **publica firmado en
> Nostr** al crear la apuesta. Antes de pagar, Luna Negra recalcula el hash y lo
> compara: si los términos fueron alterados (`CONTRACT_MISMATCH`), **no paga**.
> 💰 **Reconciliación:** el pozo siempre cuadra — toda apuesta cancelada/vencida/anulada
> reembolsa cada depósito confirmado, y los pagos = pozo − comisión.

## Paso 6 · Webhooks
Configurá una **URL de webhook** en /provider. Luna Negra te avisa (POST JSON, con
reintentos) cuando pasa algo:

| Evento | Cuándo | `data` (campos clave) |
|---|---|---|
| `purchase.completed` | un jugador compró tu juego | `purchaseId, gameId, slug, npub, amountSats` |
| `deposit.received` | un participante depositó su stake | `betId, npub, amountSats, potSats, potTargetSats, depositsReceived, depositsTotal` |
| `bet.funded` | el pozo se completó (alias `bet.ready`) | `betId, potSats, participants` |
| `bet.settled` | una apuesta se resolvió y se pagó | `betId, winners, payouts:[{npub,amountSats}], feeSats` |
| `bet.cancelled` | el proveedor canceló la apuesta | `betId, reason:"provider_cancel"` |
| `bet.expired` | venció el plazo de depósito sin completarse el pozo | `betId, reason:"deposit_timeout"` |
| `bet.refunded` | se reembolsaron depósitos (acompaña cancelled/expired/void/timeout) | `betId, reason, refunds:[{npub,amountSats}]` |
| `payout.sent` | te enviamos tu parte | `purchaseId, gameId, shareSats` |

Todos los eventos de **apuesta** incluyen además `roomId` y `metadata` (los que pasaste
en `createBet`), para correlacionar la apuesta con tu sala sin tabla propia.

Cada request trae `X-LunaNegra-Event` y `X-LunaNegra-Signature` (HMAC-SHA256 del
cuerpo con tu secreto). Verificá la firma:
```ts
import { verifyWebhook } from "@lunanegra/sdk";
// rawBody = cuerpo CRUDO (sin parsear)
if (!verifyWebhook(rawBody, req.headers["x-lunanegra-signature"], secret)) {
  return res.status(401).end();
}
const { id, type, data } = JSON.parse(rawBody);
// type: "purchase.completed" | "deposit.received" | "bet.funded" | "bet.settled"
//     | "bet.cancelled" | "bet.expired" | "bet.refunded" | "payout.sent"
```

## Paso 7 · Feed de actividad (opcional)
Para que tus novedades aparezcan en la pestaña **Actividad** de tu juego, publicá
una nota — con tu **API key**, sin tocar Nostr (Luna Negra firma con tu oráculo):
```ts
await luna.postActivity("mi-juego", "¡Nuevo torneo este finde! 🎮");
```
Equivalente HTTP: `POST /api/v1/games/{slug}/activity` con `Authorization: Bearer ln_sk_…`
y body `{ "content": "…" }`. La nota se publica como kind:1 con el tag
`["t", "lunanegra:game:<slug>"]`.

> **Avanzado:** también podés postear vos mismo una nota Nostr (kind:1) con ese tag
> desde cualquier cliente; los jugadores también pueden comentar ahí.

---

## Referencia rápida de endpoints
| Método | Endpoint | Auth | Para |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | — | Validar tokens offline |
| GET | `/api/v1/entitlements/verify` | Bearer (entitlement) | Confirmar compra |
| GET | `/api/v1/rooms/verify` | Bearer (invite) | Validar quien se une (identidad + host) |
| GET | `/api/v1/players/{npub}/profile` | — | Refrescar nombre/avatar de un jugador |
| POST | `/api/v1/bets` | Bearer (API key) | Crear apuesta |
| GET | `/api/v1/bets/{betId}` | Bearer (API key) | Estado + economía de la apuesta |
| GET | `/api/v1/bets/{betId}/deposits` | Bearer (API key) | Handles de pago por participante |
| POST | `/api/v1/bets/{betId}/cancel` | Bearer (API key) | Cancelar y reembolsar |
| POST | `/api/v1/bets/{betId}/result` | Bearer (API key) · o evento firmado | Reportar ganador (`winners:[]` = anular) |
| POST | `/api/v1/games/{slug}/activity` | Bearer (API key) | Publicar nota en el feed de Actividad |

## Checklist de integración
- [ ] Publicaste tu juego en /provider (con Lightning Address).
- [ ] En tu juego, leés `?lnToken=` y verificás el acceso (offline con JWKS).
- [ ] (Multijugador) tu lobby valida `inviteToken` con `verifyRoom`.
- [ ] (Apuestas) creaste una API key y usás `createBet` / `reportResult`.
- [ ] Configuraste un webhook y verificás su firma HMAC.
