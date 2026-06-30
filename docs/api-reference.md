# Referencia de API — Luna Negra

> Documento unificado de **todas las interfaces de programación** de Luna Negra:
> el contrato público para desarrolladores de juegos (`/api/v1`), los endpoints
> internos de la web (cookie de sesión), el panel de proveedor, la consola de
> administración, el subsistema de escrow/apuestas, los webhooks y el SDK.
>
> Generado a partir del código en `src/app/api/**`. El contrato público (lo que
> consume un dev externo) está en [`api-publica.md`](api-publica.md); para el
> contrato OpenAPI navegable ver [`public/openapi.json`](../public/openapi.json) (`/developers`).

---

## 1. Convenciones generales

| Aspecto | Decisión |
|---|---|
| Estilo | REST sobre Next.js Route Handlers (App Router) |
| Naming | camelCase en JSON |
| Fechas | ISO 8601 |
| IDs | cuid |
| Dinero (público) | enteros en **sats** |
| Dinero (interno DB) | enteros en **msat** (`stakeMsat`, `payoutMsat`…) — se exponen convertidos a sats |
| Tiempo real | **Polling** (~2–3 s) — no hay WebSocket (serverless) |

### Tipos de autenticación

| Auth | Cómo viaja | Quién la usa |
|---|---|---|
| **Cookie de sesión** (`ln_session`, JWT HS256) | Cookie httpOnly | Frontend first-party (web app de Luna Negra) |
| **Cookie + `isAdmin`** | Cookie + pubkey en allowlist | Consola `/admin` |
| **Bearer entitlement** (JWT ES256) | `Authorization: Bearer <lnToken>` | El juego, para identificar al jugador |
| **Bearer invite** (JWT ES256) | `Authorization: Bearer <inviteToken>` | El lobby del juego, para validar salas |
| **Bearer bet-session** (JWT HS256) | `Authorization: Bearer <token>` | El modal de apuestas embebido (iframe) |
| **API key** (`ln_sk_…`, hasheada) | `Authorization: Bearer ln_sk_…` | Server-to-server del proveedor |
| **Evento Nostr firmado** | body `{ event }` | Self-signer del resultado de una apuesta |
| **Firma QStash** | header `upstash-signature` | El cron del tick de escrow |

> El escrow del lado jugador acepta **cookie de sesión** (páginas first-party) **o**
> **Bearer bet-session** (modal embebido). Helper: `getPlayerAuth` (`src/lib/escrow-auth.ts`).

### Formato de errores

- **Endpoints `/api/v1` (públicos):** envelope estándar `{ "error": { "code", "message" } }` (helper `apiError` en `src/lib/api.ts`), con CORS abierto.
- **Endpoints internos:** `{ "error": "mensaje" }`; algunos de escrow agregan `{ "error", "code" }`.
- **Endpoints LNURL:** formato LUD `{ "status": "ERROR", "reason": "…" }`.

### Rate limiting

Endpoints con límite devuelven cabeceras `RateLimit-Limit/Remaining/Reset` y, en `429`, `Retry-After` (`src/lib/rate-limit.ts`). Aplicado en: auth challenge/verify, buy, escrow deposit, provider webhook (v1).

---

## 2. Mapa de endpoints

| Grupo | Prefijo | Auth | Sección |
|---|---|---|---|
| Auth / sesión | `/api/auth/*` | pública / cookie | [§3](#3-autenticación--sesión-first-party) |
| Tienda / jugador | `/api/library`, `/api/games/*`, `/api/purchases/*`, `/api/users/*`, `/api/upload`, `/api/me/*`, `/api/invites`, `/api/rooms/*` | cookie | [§4](#4-tienda-y-jugador-first-party-cookie) |
| Panel de proveedor | `/api/provider/*` | cookie | [§5](#5-panel-de-proveedor-cookie) |
| Administración | `/api/admin/*` | cookie + admin | [§6](#6-administración-cookie--admin) |
| Escrow interno | `/api/escrow/*` | cookie/bearer · QStash · LNURL | [§7](#7-escrow--apuestas-interno) |
| Contrato público (devs) | `/api/v1/*`, `/.well-known/jwks.json` | Bearer / API key | [§8](#8-contrato-público-para-desarrolladores-apiv1) |
| Webhooks (salientes) | — | HMAC firmado | [§9](#9-webhooks-salientes) |

---

## 3. Autenticación / sesión (first-party)

Login estilo NIP-98: el cliente pide un challenge, firma un evento Nostr (kind 27235) con su **extensión (NIP-07)** o con un **firmador remoto en el celu (NIP-46)** emparejado por QR, y lo canjea por una cookie de sesión JWT. Lógica en `src/lib/auth.ts`. (Existe además `/api/auth/email` para magic link custodial, pero **no está operativo**.)

### `POST /api/auth/challenge`
Emite un challenge firmado para el flujo de login. **Rate limit:** 30/min por IP.
- **Body:** `{ "pubkey": "<hex 64>" }`
- **200:** `{ "token", "nonce" }`
- **400** `pubkey inválida` · **429** demasiados intentos

### `POST /api/auth/verify`
Verifica el evento NIP-98 firmado y abre la sesión (setea la cookie `ln_session`, 30 días). Hace upsert del `User` y cachea su perfil kind:0 en background. **Rate limit:** 30/min por IP.
- **Body:** `{ "token": "<challenge>", "event": <evento Nostr kind:27235 firmado> }`
- **200:** `{ "user": { "id", "npub", "pubkey" } }` + cookie de sesión
- **401** challenge/evento/nonce/firma inválidos o evento expirado (>300 s)

### `GET /api/auth/me`
Devuelve el usuario logueado (o `null`). Auth: cookie.
- **200:** `{ "user": { "id", "npub", "pubkey", "displayName", "avatarUrl", "lud16", "isAdmin" } | null }`

### `POST /api/auth/logout`
Borra la cookie de sesión. **200:** `{ "ok": true }`

---

## 4. Tienda y jugador (first-party, cookie)

Salvo que se indique lo contrario, todos requieren cookie de sesión y responden **401** `No autenticado` si falta.

### `GET /api/library`
Juegos que posee el jugador (compras `paid`).
- **200:** `{ "games": [{ "id", "slug", "title", "coverUrl", "gameUrl" }] }`

### `POST /api/games/{id}/buy`
Inicia la compra de un juego. Gratis → entitlement inmediato; de pago → crea invoice Lightning (o placeholder en dev). **Rate limit:** 15/min por usuario.
- **200 (ya comprado):** `{ "status": "paid", "alreadyOwned": true }`
- **200 (gratis):** `{ "status": "paid", "free": true }`
- **200 (pago):** `{ "status": "pending", "purchaseId", "invoice", "amountSats", "devMode" }`
- **404** juego no encontrado · **429** demasiados intentos

### `GET /api/purchases/{id}/status`
Polling del estado de pago. Si detecta el invoice pagado, marca `paid`, dispara el payout y el webhook `purchase.completed`. Solo el dueño de la compra.
- **200:** `{ "status": "paid" | "pending" }` · **404** compra no encontrada

### `POST /api/purchases/{id}/dev-pay` *(solo dev)*
Simula el pago de una compra. **403** en producción.
- **200:** `{ "status": "paid" }`

### `GET /api/games/{id}/reviews` *(público, sin auth)*
Reseñas de un juego.
- **200:** `{ "count", "average", "reviews": [{ "id", "rating", "body", "npub", "name" }] }`

### `POST /api/games/{id}/reviews`
Crea/actualiza la reseña del jugador (debe poseer el juego). `rating` 1–5, `body` ≤2000.
- **200:** `{ "ok": true }` · **400** rating inválido · **403** no posee el juego

### `POST /api/games/{id}/sessions`
Crea una "sesión de juego": mintea el **entitlement token** (para lanzar) y un **bet-session token** (para el modal de apuestas). Requiere poseer el juego (o que sea gratis). Marca `lastPlayedAt`.
- **200:** `{ "token": "<entitlement>", "betSession": "<bet-session>" }`
- **403** sin acceso · **404** juego no encontrado

### `POST /api/games/{id}/rooms`
Crea una sala multijugador; el jugador es host. Devuelve invite token + roomId.
- **200:** `{ "token", "roomId", "host": true, "slug" }`

### `POST /api/games/{id}/rooms/{roomId}/members`
Unirse a una sala existente; emite invite token propio (`host: false`).
- **200:** `{ "token", "roomId", "host": false, "slug" }`

### `POST /api/rooms/join`
Unirse a una sala por **slug** (puntos de entrada que solo conocen el link `/game/:slug?room=…`: chat, /friends, sidebar, notificaciones). Encola la orden de lanzamiento.
- **Body:** `{ "slug", "roomId" }`
- **200:** `{ "token", "roomId", "host", "slug", "title", "gameUrl", "openGame" }`
- **400** datos inválidos · **404** juego no encontrado

### `GET /api/invites`
Buzón de invitaciones a sala del usuario (polling del `NotificationsProvider`). Devolverlas las marca como vistas.
- **200:** `{ "invites": [{ "id", "fromNpub", "roomId", "inviteUrl", "createdAt" }] }`

### `POST /api/invites`
Crea una invitación a sala desde una ventana first-party (la identidad del host sale de la cookie). Debe poseer el juego.
- **Body:** `{ "gameId", "roomId", "toNpub" }`
- **200:** `{ "ok": true, "delivered", "launchQueued", "inviteUrl", "title" }`
- **400** datos inválidos / auto-invitación · **403** sin acceso · **404** juego no encontrado

### `GET /api/me/playing`
Presencia propia (¿está jugando algo ahora?). La tienda la sondea para gobernar su estado NIP-38.
- **200:** `{ "playing": boolean, "status": string|null, "roomId": string|null }`

### `POST /api/users/me/profile`
Cachea nombre/avatar (kind:0) y/o configura la Lightning Address de cobro (`lud16`). Update parcial: solo toca campos presentes.
- **Body:** `{ "displayName"?, "avatarUrl"?, "lud16"? }`
- **200:** `{ "ok": true }` · **400** Lightning Address inválida

### `POST /api/users/known`
Resuelve qué pubkeys son usuarios de Luna Negra (para la lista de amigos). Hasta 1000 pubkeys.
- **Body:** `{ "pubkeys": ["<hex 64>", …] }`
- **200:** `{ "known": [{ "pubkey", "npub", "displayName", "lastPlayedAt", "games": [{ "slug", "title" }] }] }`

### `POST /api/upload`
Sube una imagen al volumen self-host (`/app/uploads`, servida en `/uploads/<archivo>`).
Body = bytes crudos; `?filename=` opcional. Runtime Node.
- **200:** `{ "url": "/uploads/<archivo>" }` · **400** archivo vacío · **502** error al guardar

---

## 5. Panel de proveedor (cookie)

Endpoints del panel `/provider`. Auth: cookie de sesión (el dueño del proveedor). Responden **401** si falta sesión.

### `GET /api/provider`
Perfil del proveedor del usuario + sus juegos. El secreto del oráculo **nunca** se expone (solo su pubkey).
- **200:** `{ "provider": Provider | null, "games": Game[] }`

### `POST /api/provider`
Crea/actualiza el perfil de proveedor. Al crearlo, provisiona la clave del **oráculo gestionado** (si hay `ORACLE_ENC_KEY`).
- **Body:** `{ "name", "lightningAddress"? }`
- **200:** `{ "provider": Provider }` · **400** falta nombre

### `POST /api/provider/games`
Crea un juego en estado `draft`. Genera slug único, normaliza categoría.
- **Body:** `{ "title", "description"?, "category"?, "priceSats"?, "gameUrl"?, "coverUrl"?, "horizontalCoverUrl"?, "screenshots"?[] }`
- **200:** `{ "game": Game }` · **400** falta perfil de proveedor / título

### `PATCH /api/provider/games/{id}`
Edita un juego propio (campos parciales). · **200:** `{ "game" }` · **404** no encontrado

### `DELETE /api/provider/games/{id}`
Borra un juego propio. **400** si tiene compras (sugiere despublicar). · **200:** `{ "ok": true }`

### `POST /api/provider/games/{id}/submit`
Envía a revisión un juego en `draft` → `in_review`.
- **200:** `{ "game" }` · **400** no está en borrador · **404** no encontrado

### `POST /api/provider/games/{id}/unpublish`
Devuelve el juego a `draft` (lo saca de la tienda). · **200:** `{ "game" }`

### `GET /api/provider/sales`
Últimas 100 ventas pagadas del proveedor (con su parte calculada).
- **200:** `{ "sales": [{ "id", "gameTitle", "share", "payoutStatus" }] }`

### `GET /api/provider/api-keys`
Lista las API keys activas (sin el secreto).
- **200:** `{ "keys": [{ "id", "name", "prefix", "createdAt", "lastUsedAt" }] }`

### `POST /api/provider/api-keys`
Crea una API key. **El secreto en claro (`ln_sk_…`) se devuelve una sola vez.**
- **Body:** `{ "name"? }`
- **201:** `{ "id", "name", "prefix", "key": "ln_sk_…" }` · **400** falta perfil de proveedor

### `DELETE /api/provider/api-keys/{keyId}`
Revoca (no borra) una API key. · **200:** `{ "ok": true }` · **404** no encontrada

### `POST /api/provider/oracle/rotate`
Rota la clave del oráculo gestionado (auth = sesión humana, **no** API key). Invalida los eventos firmados con la clave anterior.
- **200:** `{ "oraclePubkey" }` · **404** sin proveedor · **500** `ORACLE_ENC_KEY` no configurada

### `POST /api/provider/webhook`
Configura la URL de webhook y (re)genera el secreto de firma (variante de panel humano; ver también la variante v1 con API key en §8).
- **Body:** `{ "webhookUrl", "regenerate"? }`
- **200:** `{ "webhookUrl", "webhookSecret" }` · **400** URL inválida

---

## 6. Administración (cookie + admin)

Auth: cookie de sesión **y** pubkey en la allowlist de admin (`src/lib/admin.ts`). Responden **403** `No autorizado` si no es admin.

### `GET /api/admin/games`
Cola de moderación: juegos `in_review` + publicados sin anuncio raíz en Nostr.
- **200:** `{ "games": Game[], "unannounced": Game[] }`

### `POST /api/admin/games/{id}/approve`
Aprueba (publica) un juego y lanza su anuncio raíz en Nostr (idempotente).
- **200:** `{ "game" }`

### `POST /api/admin/games/{id}/reject`
Rechaza un juego en revisión → vuelve a `draft`. · **200:** `{ "game" }`

### `POST /api/admin/games/{id}/announce`
Re-anuncia en Nostr un juego publicado sin posteo raíz.
- **200:** `{ "game" }` o `{ "game", "alreadyAnnounced": true }`
- **400** no publicado · **404** no encontrado · **502** no se pudo publicar

### `GET /api/admin/payouts`
Payouts pendientes (`failed`/`skipped`/`pending`) para reintentar.
- **200:** `{ "payouts": [{ "id", "gameTitle", "providerName", "lightningAddress", "share", "payoutStatus" }] }`

### `POST /api/admin/payouts/{id}/retry`
Resetea el estado no-pagado y reintenta el payout.
- **200:** `{ "payoutStatus", "payoutHash" }`

### `GET /api/admin/bets`
Últimas 50 apuestas (todas).
- **200:** `{ "bets": [{ "id", "gameTitle", "status", "stakeSats", "paid", "total" }] }`

---

## 7. Escrow / apuestas (interno)

Subsistema de custodia del pozo. La cara **pública** (devs) vive en `/api/v1/bets/*` (§8); estos son los endpoints internos: del lado jugador (cookie/bet-session), el cron del tick y los handlers LNURL. Estados internos: `pending_deposits → ready → settled/refunding/cancelled_admin`.

### `GET /api/escrow/bets/{id}`
Estado de una apuesta para el modal (polling ~3 s). Auth opcional (`getPlayerAuth`): si el que consulta es participante, detecta su depósito on-demand y expone su `withdrawUrl` (LNURL-withdraw) cuando hay payout pendiente.
- **200:** `{ "id", "status", "stakeSats", "feePct", "victoryCondition", "depositDeadline", "resolveDeadline", "contractEventId", "gameTitle", "gameSlug", "providerName", "participants": [{ "npub", "name", "paid", "refunded" }], "me": { "paid", "result", "payoutStatus", "depositInvoice", "withdrawUrl" } | null }`
- **404** `BET_NOT_FOUND`

### `POST /api/escrow/bets/{id}/deposit`
Devuelve el invoice de depósito del participante (idempotente: mismo invoice). Auth: `getPlayerAuth`. **Rate limit:** 30/min por usuario.
- **200:** `{ "invoice", "paymentHash", … }` (de `ensureDepositInvoice`)
- **401** `UNAUTHENTICATED` · **403** `NOT_PARTICIPANT` · **404** `BET_NOT_FOUND` · **409** `ALREADY_PAID` · **410** `DEPOSIT_CLOSED` · **429** `RATE_LIMITED`

### `POST /api/escrow/bets/{id}/dev-deposit` *(solo dev)*
Simula el depósito del jugador (marca `paid`, dispara `deposit.received` y, si se completa, `bet.funded`). **403** en producción.
- **200:** `{ "ok": true }`

### `POST /api/escrow/bets/{id}/cancel`
Cancelación **admin** de una apuesta incompleta (`pending_deposits`) → reembolso. Auth: cookie + admin.
- **200:** `{ "ok": true }` · **400** no incompleta · **403** no admin · **404** no encontrada · **409** estado cambiado

### `GET /api/escrow/bets/mine`
Historial de apuestas del jugador (sección "Apuestas"). Auth: cookie.
- **200:** `{ "bets": [{ "id", "gameId", "gameSlug", "gameTitle", "status", "stakeSats", "depositStatus", "result", "payoutStatus", "createdAt" }] }`

### `POST /api/escrow/tick`
Procesa plazos (depósitos 10 m, resolución 15 m, payouts/reembolsos). Auth: **firma QStash** (`upstash-signature`); en dev sin claves se permite a mano; en prod sin claves se bloquea.
- **200:** `{ "ok": true, …resumen }` · **401** sin firma / firma inválida / no configurado

### `GET /api/escrow/lnurlw/{token}` *(LNURL-withdraw, LUD-03)*
El wallet pide los parámetros del retiro. Token de un solo uso (`signWithdrawToken`). CORS abierto.
- **200:** `{ "tag": "withdrawRequest", "callback", "k1", "defaultDescription", "minWithdrawable", "maxWithdrawable" }`
- **error:** `{ "status": "ERROR", "reason" }` (token inválido / retiro no disponible)

### `GET /api/escrow/lnurlw/{token}/callback`
El wallet manda su invoice (`pr`) y Luna Negra lo paga. Claim atómico anti doble-retiro; valida el monto exacto.
- **200:** `{ "status": "OK" }` · **error:** `{ "status": "ERROR", "reason" }`

### `GET /api/escrow/lnurlp/{pid}` *(LNURL-pay, LUD-06)*
Depósito de un participante por LNURL. Dos pasos: sin `?amount` → `payRequest`; con `?amount` (= stake exacto) → `{ "pr": "<bolt11>" }`. Respalda el handle `lnurl` de la vista de depósitos.
- **200 (paso 1):** `{ "tag": "payRequest", "callback", "minSendable", "maxSendable", "metadata" }`
- **200 (paso 2):** `{ "pr", "routes": [] }`
- **error:** `{ "status": "ERROR", "reason" }`

---

## 8. Contrato público para desarrolladores (`/api/v1`)

Contrato versionado y estable para devs de juegos. CORS abierto, errores en envelope `{ error: { code, message } }`. Detalle público: [`api-publica.md`](api-publica.md) · OpenAPI: [`public/openapi.json`](../public/openapi.json).

### Tokens y verificación

#### `GET /.well-known/jwks.json` (alias `/api/v1/jwks`)
Claves públicas ES256 para validar **offline** los tokens de dev. Cache 300 s.
- **200:** `{ "keys": [ <JWK> ] }`

#### `GET /api/v1/session`
Canjea el `?lnToken=` (entitlement) por la identidad del jugador (login SSO). Auth: Bearer entitlement.
- **200:** `{ "npub", "pubkey", "displayName", "avatarUrl", "gameId" }`
- **400** `MISSING_TOKEN` · **401** `INVALID_TOKEN`

#### `GET /api/v1/entitlements/verify`
Confirma que el jugador compró el juego (alternativa al verify offline). Auth: Bearer entitlement.
- **200:** `{ "valid": true, "npub", "gameId", "slug" }` · `{ "valid": false }`
- **400** falta token

#### `GET /api/v1/rooms/verify`
Valida el invite token de quien se une a una sala. Auth: Bearer invite.
- **200:** `{ "valid", "npub", "pubkey", "displayName", "avatarUrl", "gameId", "slug", "roomId", "host", "hostNpub", "hostPubkey", "expiresAt" }`
- **400** falta token

#### `GET /api/v1/players/{npub}/profile` *(público)*
Nombre/avatar (kind:0 cacheado) por npub, para refrescar la presentación.
- **200:** `{ "npub", "pubkey", "displayName", "avatarUrl" }` · **400** npub inválido

### Multijugador / presencia

#### `POST /api/v1/rooms/{roomId}/presence`
Heartbeat + roster de la sala (~2 s). Auth: Bearer invite.
- **Body:** `{ "clientId", "score"?, "leave"? }`
- **200:** `{ "members": [{ "clientId", "npub", "host", "score", "name", "avatar" }] }`
- **401** token inválido para la sala

#### `POST /api/v1/presence`
Heartbeat de presencia del juego (~10 s, TTL ~30 s). Auth: API key.
- **Body:** `{ "npub", "status": "in-game"|"online", "game"?, "roomId"?, "state"? }` (`status` reservado; `state` = bolsa libre ≤2KB, last-write-wins)
- `game` (opcional, recomendado): slug (o id) del juego en el que está el jugador. Si lo mandás, la curva de "jugadores concurrentes" se cuenta **por juego**; si lo omitís, la presencia queda a nivel proveedor y los juegos del proveedor comparten la curva (compat). Debe ser un juego tuyo; si no matchea, se ignora (cae a provider-wide).
- **200:** `{ "ok": true }` · **400** `INVALID_NPUB`/`INVALID_STATUS` · **401** `INVALID_API_KEY`

#### `GET /api/v1/friends`
Amigos (contactos NIP-02) con su presencia en este juego. Auth: API key. Query: `npub`, `presence=true`, `q=<texto>` (con `q`, si no hay match en follows busca en todo Nostr; los externos llevan `isFollow:false`).
- **200:** `{ "friends": [{ "npub", "displayName", "avatarUrl", "presence", "roomId", "state", "lastSeenMs", "isMember", "lastPlayedAt", "isFollow" }], "query"? }`
- **400** `INVALID_NPUB` · **401** `INVALID_API_KEY`

#### `POST /api/v1/invites`
Invita a un amigo a una sala (Luna Negra muestra el toast in-app). Auth: API key. Reemplaza a `friends/invite` + `launch-requests`.
- **Body:** `{ "fromNpub", "toNpub", "roomId", "inviteUrl", "gameId"? }`
- **200:** `{ "delivered", "launchQueued" }`
- **400** `INVALID_NPUB`/`MISSING_ROOM`/`INVALID_INVITE_URL` · **401** `INVALID_API_KEY`

#### `GET /api/v1/invites`
Orden de entrada a sala pendiente para un juego abierto (polling). Auth: API key. Query: `npub`.
- **200:** `{ "request": { … } | null }` · **400** `INVALID_NPUB` · **401** `INVALID_API_KEY`

#### `GET·POST /api/v1/rooms/{roomId}/state`
Estado compartido de la sala para juegos **sin backend propio** (tablero común + estado por jugador, estilo `SetLobbyData`/`SetLobbyMemberData` de Steam). Auth: **Bearer invite**. TTL ~60 s: cada POST renueva la sala y registra al jugador en `members` (heartbeat). La plataforma no interpreta las claves.
- **POST body:** `{ "set"?, "self"?, "version"? }` — `set` (objeto ≤8KB) mezcla en la bolsa compartida (last-write-wins por clave); `version` opcional = CAS; `self` (≤2KB) reemplaza la bolsa del jugador.
- **GET:** `{ "data", "version", "members": [{ "npub", "name", "avatar", "state" }] }`. Trae `ETag` (polling con `If-None-Match` → `304`); `Cache-Control: no-store`.
- **400** `INVALID_SET`/`INVALID_SELF`/`STATE_TOO_LARGE` · **401** `INVALID_TOKEN` · **409** `VERSION_CONFLICT`
- Implementación: `src/lib/room-state.ts` + `src/app/api/v1/rooms/[roomId]/state/route.ts`. Modelos `RoomState`/`RoomMemberState`.

### Marcador (Bearer entitlement)

Rankings por juego. ⚠️ **Anti-trampa:** el puntaje lo manda el cliente y es **falsificable** → sirve para **mostrar** rankings (como Steam), **NO** para resolver apuestas (eso viene del game server por `/result`, firmado por el oráculo).

#### `POST /api/v1/leaderboards/{name}/scores`
Sube el puntaje del jugador (`name` lo elige el juego). Política **"se queda el mejor"**. Auth: Bearer entitlement (npub/juego del token).
- **Body:** `{ "score" }` (entero 0…1e9)
- **200:** `{ "score", "rank", "improved" }` · **400** `INVALID_NAME`/`INVALID_SCORE` · **401** `INVALID_TOKEN`

#### `GET /api/v1/leaderboards/{name}`
Lee el marcador. Auth: Bearer entitlement. Query: `window=all|week`, `view=top|around`, `npub` (requerido para `around`).
- **200:** `{ "entries": [{ "npub", "displayName", "score", "rank" }] }` (vacío si no existe). `Cache-Control: no-store`.
- **401** `INVALID_TOKEN`
- Implementación: `src/lib/leaderboard.ts` + `src/app/api/v1/leaderboards/[name]/{route,scores}`. Modelos `Leaderboard`/`Score`.

### Apuestas / escrow (API key)

Auth: API key del proveedor dueño. Montos en **sats**. Detalle de economía/estados en [`api-publica.md`](api-publica.md) §3.

#### `POST /api/v1/bets`
Crea una apuesta (pozo winner-takes-all); publica el contrato firmado en Nostr. Soporta `Idempotency-Key` (reintento seguro).
- **Body:** `{ "gameId", "participants": ["npub", …] (≥2), "stakeSats", "victoryCondition"?, "roomId"?, "metadata"? }`
- **201:** `{ "betId", "contractEventId", "depositDeadline", "stakeSats", "potTargetSats", "feePct", "feeBps", "feeSats", "netPayoutSats", "roomId", "metadata" }`
- **400** `STAKE_OUT_OF_RANGE` · **401** API key inválida · **403** el juego no es de tu proveedor

#### `GET /api/v1/bets/{id}`
Estado + economía + **handles de pago** en una sola llamada. `Cache-Control: no-store`.
- **200:** `BetDetail` (`status`, `depositsReceived`, `depositsTotal`, `potSats`, `feeSats`, `netPayoutSats`, `metadata`, `participants[]` con `depositStatus`, `result`, `payoutStatus`, `payoutSats`, `bolt11`, `lnurl`, `payUrl`, …). Los handles van `null` cuando el depósito ya cerró.
- **401** · **403** `NOT_BET_OWNER` · **404** no encontrada

#### `POST /api/v1/bets/{id}/cancel`
Cancela una apuesta no resuelta (`pending_deposits`/`funded`) y reembolsa. Emite `bet.cancelled` + `bet.refunded`.
- **200:** `{ "ok": true, "status": "cancelled" }`
- **401** · **403** `NOT_BET_OWNER` · **404** · **409** `ALREADY_RESOLVED`/`CANNOT_CANCEL`

#### `POST /api/v1/bets/{id}/result`
Reporta el resultado. Dos caminos:
1. **API key (recomendado):** body `{ "winners": ["npub", …] }` (vacío = empate/anulación → reembolso). Luna Negra firma con el oráculo gestionado.
2. **Evento firmado (avanzado):** body `{ "event": <Nostr firmado por el oráculo> }` (tags `bet`, `winner`).

Verifica el contrato (`CONTRACT_MISMATCH`) antes de pagar. **Idempotente:** si la
apuesta ya está en estado terminal, devuelve `200 { ok:true, alreadyResolved:true, status }` sin re-pagar.
- **200:** `{ "ok": true, "voided"?, "alreadyResolved"?, "status"? }`
- **401** firma/API key inválida · **403** `FORBIDDEN`/`WRONG_SIGNER` · **409** `NOT_READY` / `CONTRACT_MISMATCH` / `ORACLE_NOT_PROVISIONED`

#### `POST /api/v1/games/{slug}/activity`
Publica una nota (kind:1, tag `lunanegra:game:<slug>`) en la pestaña Actividad. Auth: API key (firma el oráculo).
- **Body:** `{ "content": "<1–2000 chars>" }`
- **200:** `{ "ok": true, "eventId", "pubkey" }` · **403** `FORBIDDEN` · **409** `ORACLE_NOT_PROVISIONED`

### Webhooks (config por API key)

#### `GET /api/v1/provider/webhook`
Lee la config actual (URL + secreto), sin rotar. Auth: API key.
- **200:** `{ "url", "secret" }` · **401** `INVALID_API_KEY` · **404** `PROVIDER_NOT_FOUND`

#### `POST /api/v1/provider/webhook`
Registra la URL y obtiene/rota el secreto de firma. `regenerate:true` rota e invalida el anterior; `url` vacía borra la config. **Rate limit:** 30/min. Auth: API key.
- **Body:** `{ "url", "regenerate"? }`
- **200:** `{ "url", "secret" }`
- **400** `INVALID_WEBHOOK_URL` · **401** `INVALID_API_KEY` · **429** `RATE_LIMITED`

---

## 9. Webhooks (salientes)

Luna Negra hace **POST JSON** (con reintentos vía QStash) a la URL configurada por el proveedor. Cabeceras `X-LunaNegra-Event` y `X-LunaNegra-Signature` (HMAC-SHA256 del cuerpo crudo con el secreto `whsec_…`). Verificar con `verifyWebhook()` del SDK. Cuerpo: `{ "id", "type", "created", "data" }`.

| Evento | Cuándo | `data` (campos clave) |
|---|---|---|
| `purchase.completed` | un jugador compró tu juego | `purchaseId, gameId, slug, npub, amountSats` |
| `deposit.received` | un participante depositó | `betId, npub, amountSats, potSats, potTargetSats, depositsReceived, depositsTotal` |
| `bet.funded` | el pozo se completó | `betId, potSats, participants` |
| `bet.settled` | apuesta resuelta y pagada | `betId, winners, payouts:[{npub,amountSats}], feeSats` |
| `bet.cancelled` | el proveedor canceló | `betId, reason:"provider_cancel"` |
| `bet.expired` | venció el plazo de depósito | `betId, reason:"deposit_timeout"` |
| `bet.refunded` | se reembolsaron depósitos | `betId, reason, refunds:[{npub,amountSats}]` |
| `payout.sent` | te enviamos tu parte | `purchaseId, gameId, shareSats` |

Todos los eventos de apuesta incluyen además `roomId` y `metadata` (los pasados en `createBet`). Implementación en `src/lib/webhooks.ts`.

---

## 10. SDK de TypeScript

`@lunanegra/sdk` ([`sdk/index.ts`](../sdk/index.ts)) envuelve el contrato público:

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
| `getBet(id)` | `GET /api/v1/bets/{id}` (incluye los handles de pago) |
| `cancelBet(id)` | `POST /api/v1/bets/{id}/cancel` |
| `reportWinners(id, npubs)` | `POST /api/v1/bets/{id}/result` (camino API key) |
| `buildResultEvent(id, npubs)` / `reportResult(id, signed)` | self-sign del resultado |
| `postActivity(slug, content)` | `POST /api/v1/games/{slug}/activity` |
| `setWebhook(url)` / `getWebhook()` | `POST`/`GET /api/v1/provider/webhook` |
| `verifyWebhook(rawBody, sig, secret)` | verificación HMAC de webhooks |

---

## Apéndice · Helpers de referencia

| Helper | Archivo | Rol |
|---|---|---|
| `getSession` / `signSession` | `src/lib/auth.ts` | cookie de sesión |
| `signEntitlement` / `verifyEntitlement` | `src/lib/auth.ts` | token de acceso (ES256) |
| `signBetSession` / `getPlayerAuth` | `src/lib/auth.ts` · `src/lib/escrow-auth.ts` | auth del modal de apuestas |
| `signWithdrawToken` / `verifyWithdrawToken` | `src/lib/auth.ts` | LNURL-withdraw de un solo uso |
| `generateApiKey` / `verifyApiKey` | `src/lib/api-keys.ts` | API keys de proveedor |
| `getJwks` | `src/lib/jwks.ts` | JWKS público (ES256) |
| `apiOk` / `apiError` / `corsPreflight` / `bearerToken` | `src/lib/api.ts` | envelope + CORS de `/api/v1` |
| `checkRateLimit` / `rateLimitHeaders` | `src/lib/rate-limit.ts` | rate limiting |
| `isAdmin` | `src/lib/admin.ts` | allowlist de admin |
| `generateOracleKey` / `rotateOracleKey` | `src/lib/oracle-keys.ts` | oráculo gestionado |
| `buildWebhookUpdate` / `emit*` | `src/lib/webhooks.ts` | config y emisión de webhooks |
| `runTick` / `checkAndSettleDeposit` | `src/lib/escrow-tick.ts` | cron de escrow |
