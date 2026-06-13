# Contrato público de API — Luna Negra

> **Solo el contrato público** que Luna Negra ofrece a los desarrolladores de
> juegos: tokens y verificación, multijugador/presencia, apuestas/escrow y
> webhooks. Estable y versionado bajo `/api/v1`.
>
> Endpoints internos (cookie de sesión, panel, admin, escrow interno) **no** forman
> parte de este contrato y pueden cambiar sin aviso — ver
> [`docs/api-reference.md`](api-reference.md) para la referencia completa.
>
> Material relacionado: OpenAPI navegable [`public/openapi.json`](../public/openapi.json)
> (`/developers`) · SDK [`sdk/index.ts`](../sdk/index.ts) · referencia interna completa
> [`api-reference.md`](api-reference.md).

---

## Convenciones

| Aspecto | Decisión |
|---|---|
| Base URL | `https://<LUNA_NEGRA>` (tu deploy) |
| Autenticación | siempre `Authorization: Bearer <token-o-api-key>` |
| Errores | `{ "error": { "code", "message" } }` + status HTTP correcto |
| CORS | habilitado en todos los endpoints públicos |
| Dinero | enteros en **sats** |
| Fechas | ISO 8601 |
| Tiempo real | **polling** (no hay WebSocket) |

### Credenciales

| Credencial | Formato | Para |
|---|---|---|
| **entitlement token** | JWT ES256 | identificar al jugador que abre el juego (`?lnToken=`) |
| **invite token** | JWT ES256 | validar a quien se une a una sala (`?inviteToken=`) |
| **API key** | `ln_sk_…` | operaciones server-to-server (apuestas, presencia, webhooks) |
| **webhook secret** | `whsec_…` | verificar la firma HMAC de los webhooks |

Los tokens ES256 se validan **offline** con la clave pública del JWKS (recomendado)
o contra los endpoints `/verify`.

---

## 1. Tokens y verificación

### `GET /.well-known/jwks.json`
Claves públicas ES256 para validar **offline** los tokens (entitlement / invite). Cache 300 s.
- **200:** `{ "keys": [ <JWK> ] }`

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
const JWKS = createRemoteJWKSet(new URL("https://<LUNA_NEGRA>/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: "luna-negra",
  audience: "lunanegra:game",
});
// payload.scope === "entitlement" | "invite"; payload.sub === npub
```

### `GET /api/v1/session`
Canjea el `?lnToken=` (entitlement) por la identidad del jugador (login SSO). Auth: Bearer entitlement.
- **200:** `{ "npub", "pubkey", "displayName", "avatarUrl", "gameId" }`
- **400** `MISSING_TOKEN` · **401** `INVALID_TOKEN`

### `GET /api/v1/entitlements/verify`
Confirma que el jugador compró el juego (alternativa al verify offline). Auth: Bearer entitlement.
- **200:** `{ "valid": true, "npub", "gameId", "slug" }` · `{ "valid": false }`
- **400** falta el token

> Verificá el token **en tu backend** antes de servir contenido pago.

---

## 2. Multijugador y presencia

### `GET /api/v1/rooms/verify`
Valida el invite token de quien se une a una sala. Auth: Bearer invite.
- **200:** `{ "valid", "npub", "pubkey", "displayName", "avatarUrl", "gameId", "slug", "roomId", "host", "hostNpub", "hostPubkey", "expiresAt" }`
- **400** falta el token

> `npub`/`pubkey` = identidad **estable** (usalos como `playerId`, nunca un UUID local).
> `displayName`/`avatarUrl` son solo presentación (pueden ser `null`).

### `GET /api/v1/players/{npub}/profile`
Nombre/avatar (kind:0 cacheado) por npub, para refrescar la presentación. Público.
- **200:** `{ "npub", "pubkey", "displayName", "avatarUrl" }` · **400** npub inválido

### `POST /api/v1/rooms/{roomId}/presence`
Heartbeat + roster de la sala (~2 s). Auth: Bearer invite.
- **Body:** `{ "clientId", "score"?, "leave"? }`
- **200:** `{ "members": [{ "clientId", "npub", "host", "score", "name", "avatar" }] }`
- **401** token inválido para la sala

### `POST /api/v1/presence`
Heartbeat de presencia del juego (~10 s, TTL ~30 s). Auth: API key.
- **Body:** `{ "npub", "status": "in-game"|"online", "roomId"? }`
- **200:** `{ "ok": true }` · **400** `INVALID_NPUB`/`INVALID_STATUS` · **401** `INVALID_API_KEY`

### `GET /api/v1/friends`
Amigos (contactos NIP-02) con su presencia en este juego. Auth: API key.
Query: `npub`, `presence=true`, `q=<texto>` (con `q`, si no hay match en follows busca en todo Nostr; los externos llevan `isFollow:false`).
- **200:** `{ "friends": [{ "npub", "displayName", "avatarUrl", "presence", "roomId", "lastSeenMs", "isMember", "lastPlayedAt", "isFollow" }], "query"? }`
- **400** `INVALID_NPUB` · **401** `INVALID_API_KEY`

### `POST /api/v1/friends/invite`
Invita a un amigo a una sala (Luna Negra muestra el toast in-app al invitado). Auth: API key.
- **Body:** `{ "fromNpub", "toNpub", "roomId", "inviteUrl", "gameId"? }`
- **200:** `{ "delivered", "launchQueued" }`
- **400** `INVALID_NPUB`/`MISSING_ROOM`/`INVALID_INVITE_URL` · **401** `INVALID_API_KEY`

### `GET /api/v1/launch-requests`
Órdenes de entrada a sala pendientes para un juego abierto (polling). Auth: API key. Query: `npub`.
- **200:** `{ "request": { … } | null }` · **400** `INVALID_NPUB` · **401** `INVALID_API_KEY`

---

## 3. Apuestas / escrow

Auth: **API key** del proveedor dueño. Montos en **sats**. Tu game server crea apuestas;
Luna Negra custodia el pozo y paga a los ganadores (menos un fee configurable).

> 🔒 **Confianza:** el contrato (stake, fee, participantes) se publica **firmado en
> Nostr** al crear la apuesta. Antes de pagar, Luna Negra recalcula el hash y lo
> compara: si los términos fueron alterados (`CONTRACT_MISMATCH`), **no paga**.

### `POST /api/v1/bets`
Crea una apuesta (pozo winner-takes-all). Soporta `Idempotency-Key` (reintento seguro).
- **Body:** `{ "gameId", "participants": ["npub", …] (≥2), "stakeSats", "victoryCondition"?, "roomId"?, "metadata"? }`
- **201:** `{ "betId", "contractEventId", "depositDeadline", "stakeSats", "potTargetSats", "feePct", "feeBps", "feeSats", "netPayoutSats", "roomId", "metadata" }`
- **400** `STAKE_OUT_OF_RANGE` · **401** API key inválida · **403** el juego no es de tu proveedor

### `GET /api/v1/bets/{id}`
Estado + economía de la apuesta.
- **200:** `{ "betId", "gameId", "status", "victoryCondition", "depositDeadline", "resolveDeadline", "potSats", "participants": [{ "npub", "depositStatus", "result", "payoutStatus", "payoutSats" }], "stakeSats", "potTargetSats", "feePct", "feeSats", "netPayoutSats", "roomId", "metadata", "contractEventId", "resultEventId" }`
- `status`: `pending_deposits | funded | settled | cancelled | expired | refunded`
- **401** · **403** `NOT_BET_OWNER` · **404** no encontrada

### `GET /api/v1/bets/{id}/deposits`
Handles de pago por participante. Cada uno: `bolt11` (invoice fijo), `lnurl` (LNURL-pay), `payUrl` (deep-link). `null` cuando el depósito ya cerró.
- **200:** `{ "betId", "status", "stakeSats", "potSats", "potTargetSats", "depositsReceived", "depositsTotal", "depositDeadline", "deposits": [{ "npub", "depositStatus", "bolt11", "lnurl", "payUrl" }] }`
- **401** · **403** `NOT_BET_OWNER` · **404** no encontrada

### `POST /api/v1/bets/{id}/cancel`
Cancela una apuesta no resuelta (`pending_deposits`/`funded`) y reembolsa los depósitos confirmados. Emite `bet.cancelled` + `bet.refunded`.
- **200:** `{ "ok": true, "status": "cancelled" }`
- **401** · **403** `NOT_BET_OWNER` · **404** · **409** `ALREADY_RESOLVED`/`CANNOT_CANCEL`

### `POST /api/v1/bets/{id}/result`
Reporta el resultado. Dos caminos:
1. **API key (recomendado):** `{ "winners": ["npub", …] }` (vacío = empate/anulación → reembolso total sin comisión). Luna Negra firma con el oráculo gestionado.
2. **Evento firmado (avanzado):** `{ "event": <Nostr firmado por tu oráculo> }` (tags `bet`, `winner`).

- **200:** `{ "ok": true, "voided"? }`
- **401** firma/API key inválida · **403** `FORBIDDEN`/`WRONG_SIGNER` · **409** estado inválido / `CONTRACT_MISMATCH` / `ORACLE_NOT_PROVISIONED`

Reparto: un ganador se lleva `netPayoutSats`; varios → partes iguales (resto indivisible
lo retiene la casa con la comisión); sin ganadores → reembolso total sin comisión.

### `POST /api/v1/games/{slug}/activity`
Publica una nota (kind:1, tag `lunanegra:game:<slug>`) en la pestaña Actividad. Auth: API key (firma el oráculo gestionado).
- **Body:** `{ "content": "<1–2000 chars>" }`
- **200:** `{ "ok": true, "eventId", "pubkey" }` · **403** `FORBIDDEN` · **409** `ORACLE_NOT_PROVISIONED`

---

## 4. Webhooks

### Configuración (por API key)

#### `GET /api/v1/provider/webhook`
Lee la config actual (URL + secreto), sin rotar. Pensado para leer el secreto al arrancar el game server.
- **200:** `{ "url", "secret" }` · **401** `INVALID_API_KEY` · **404** `PROVIDER_NOT_FOUND`

#### `POST /api/v1/provider/webhook`
Registra la URL y obtiene/rota el secreto de firma. `regenerate:true` rota e invalida el anterior; `url` vacía borra la config. **Rate limit:** 30/min.
- **Body:** `{ "url", "regenerate"? }`
- **200:** `{ "url", "secret" }`
- **400** `INVALID_WEBHOOK_URL` · **401** `INVALID_API_KEY` · **429** `RATE_LIMITED`

### Eventos (salientes)

Luna Negra hace **POST JSON** (con reintentos) a tu URL. Cabeceras `X-LunaNegra-Event` y
`X-LunaNegra-Signature` (HMAC-SHA256 del cuerpo crudo con tu secreto). Cuerpo:
`{ "id", "type", "created", "data" }`. Verificá la firma con `verifyWebhook()` del SDK.

| Evento | Cuándo | `data` (campos clave) |
|---|---|---|
| `purchase.completed` | un jugador compró tu juego | `purchaseId, gameId, slug, npub, amountSats` |
| `deposit.received` | un participante depositó | `betId, npub, amountSats, potSats, potTargetSats, depositsReceived, depositsTotal` |
| `bet.funded` *(alias `bet.ready`)* | el pozo se completó | `betId, potSats, participants` |
| `bet.settled` | apuesta resuelta y pagada | `betId, winners, payouts:[{npub,amountSats}], feeSats` |
| `bet.cancelled` | el proveedor canceló | `betId, reason:"provider_cancel"` |
| `bet.expired` | venció el plazo de depósito | `betId, reason:"deposit_timeout"` |
| `bet.refunded` | se reembolsaron depósitos | `betId, reason, refunds:[{npub,amountSats}]` |
| `payout.sent` | te enviamos tu parte | `purchaseId, gameId, shareSats` |

Todos los eventos de apuesta incluyen además `roomId` y `metadata` (los pasados en `createBet`).

---

## 5. SDK de TypeScript

`@lunanegra/sdk` ([`sdk/index.ts`](../sdk/index.ts)) envuelve este contrato:

```ts
import { createClient } from "@lunanegra/sdk";
const luna = createClient({ baseUrl: "https://<LUNA_NEGRA>", apiKey: "ln_sk_…" });
```

| Método | Endpoint |
|---|---|
| `verifyAccess(token)` | validación offline del entitlement (JWKS) |
| `verifyRoom(token)` | validación offline del invite (JWKS) |
| `getPlayerProfile(npub)` | `GET /api/v1/players/{npub}/profile` |
| `createBet(opts)` | `POST /api/v1/bets` |
| `getBet(id)` / `getBetDeposits(id)` | `GET /api/v1/bets/{id}` · `/deposits` |
| `cancelBet(id)` | `POST /api/v1/bets/{id}/cancel` |
| `reportWinners(id, npubs)` | `POST /api/v1/bets/{id}/result` (camino API key) |
| `buildResultEvent(id, npubs)` / `reportResult(id, signed)` | self-sign del resultado |
| `postActivity(slug, content)` | `POST /api/v1/games/{slug}/activity` |
| `setWebhook(url)` / `getWebhook()` | `POST`/`GET /api/v1/provider/webhook` |
| `verifyWebhook(rawBody, sig, secret)` | verificación HMAC de webhooks |

---

## Referencia rápida de endpoints

| Método | Endpoint | Auth |
|---|---|---|
| GET | `/.well-known/jwks.json` | — |
| GET | `/api/v1/session` | Bearer entitlement |
| GET | `/api/v1/entitlements/verify` | Bearer entitlement |
| GET | `/api/v1/rooms/verify` | Bearer invite |
| GET | `/api/v1/players/{npub}/profile` | — |
| POST | `/api/v1/rooms/{roomId}/presence` | Bearer invite |
| POST | `/api/v1/presence` | API key |
| GET | `/api/v1/friends` | API key |
| POST | `/api/v1/friends/invite` | API key |
| GET | `/api/v1/launch-requests` | API key |
| POST | `/api/v1/bets` | API key |
| GET | `/api/v1/bets/{id}` | API key |
| GET | `/api/v1/bets/{id}/deposits` | API key |
| POST | `/api/v1/bets/{id}/cancel` | API key |
| POST | `/api/v1/bets/{id}/result` | API key · o evento firmado |
| POST | `/api/v1/games/{slug}/activity` | API key |
| GET | `/api/v1/provider/webhook` | API key |
| POST | `/api/v1/provider/webhook` | API key |
