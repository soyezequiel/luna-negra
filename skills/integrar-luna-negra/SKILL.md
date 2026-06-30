---
name: integrar-luna-negra
description: >-
  Guía completa y modular para hacer compatible un juego con Luna Negra
  (tienda de juegos con identidad Nostr y pagos Lightning/sats). Cubre login SSO,
  verificación de compra, presencia "jugando X", salas multijugador con estado
  compartido, invitaciones, amigos, marcadores, apuestas/escrow, webhooks y el
  SDK de TypeScript. Usar cuando el usuario quiere integrar su juego con Luna
  Negra, agregar login con Nostr, cobrar/apostar en sats o Lightning, hacer
  multijugador, presencia, invitaciones o marcadores. No hace falta aplicar todo:
  cada bloque es independiente y se adopta por separado.
license: MIT
---

# Integrar tu juego con Luna Negra

Luna Negra es una **capa de tienda, identidad, pagos y social** alrededor de tu
juego. Tu juego sigue siendo tuyo: la plataforma resuelve las partes comunes
(login, cobros en Lightning/sats, apuestas, presencia, salas) para que no las
construyas desde cero. Tu juego vive en su propia URL; Luna Negra lo abre, le
dice quién es el jugador y le ofrece estos servicios por HTTP.

> **Esto es un menú, no un contrato de todo-o-nada.** Aplica solo los bloques que
> te sirvan. El mínimo útil es **§1 Identidad (SSO)**. Todo lo demás —presencia,
> salas, apuestas, marcadores, webhooks— es opcional y se suma cuando lo
> necesites. Si el usuario solo pide "login con Nostr", implementa §1 y para ahí.

---

## Cómo usar esta skill (para el agente)

1. **Pregunta primero qué quiere integrar.** Ofrece el menú (§1–§8) y deja que el
   usuario elija. No implementes apuestas/escrow ni webhooks "por las dudas".
2. **Averigua la URL del deploy de Luna Negra** (la base URL). En esta guía
   aparece como `__LUNA_NEGRA_BASE__`. Si el instalador la rellenó, ya está la
   real; si ves el placeholder, **pregunta al usuario** cuál es su deploy
   (el oficial es `https://luna.naranja.fit`; un self-host puede tener otro
   dominio) y úsala en todo el código.
3. **Identifica el stack del juego.** Web (JS en navegador), servidor (Node, Go,
   Python…), o motor (Unity/Godot). Las llamadas son HTTP estándar: adapta los
   ejemplos `fetch` a su lenguaje.
4. **Respeta la frontera cliente/servidor** (§"Reglas de oro"). La `API key`
   (`ln_sk_…`) **jamás** va al navegador. Las apuestas y los resultados se deciden
   en el game server, nunca en el cliente.
5. **Implementa el bloque elegido**, prueba con `__LUNA_NEGRA_BASE__/developers`
   (referencia interactiva) y `__LUNA_NEGRA_BASE__/openapi.json` (contrato).

---

## Conceptos base

| Concepto | Qué es | Detalle técnico |
|---|---|---|
| **Proveedor** | Tu estudio/equipo en Luna Negra | Owner que crea juegos, API keys, webhooks y recibe los payouts |
| **Juego** | La experiencia que publicas | Entidad con `gameId`, `slug`, precio, URL y assets |
| **Jugador** | Quien compra o entra a jugar | Identidad Nostr **estable**: `npub` (bech32) y `pubkey` (hex) |
| **Entitlement** | Pase temporal de acceso | JWT ES256 que llega como `?lnToken=…` al abrir el juego |
| **Invite token** | Pase a una sala | JWT ES256 que llega como `?inviteToken=…` |
| **API key** | Llave server-to-server | `ln_sk_…` — **secreta, solo en tu backend** |
| **Webhook secret** | Verifica avisos entrantes | `whsec_…` para validar la firma HMAC |

**Convenciones de la API** (todas estables bajo `/api/v1`):

- Autenticación: siempre `Authorization: Bearer <token-o-api-key>`.
- Dinero: enteros en **sats**. Fechas: ISO 8601.
- Errores: `{ "error": { "code", "message" } }` + status HTTP correcto.
- Éxito: el cuerpo es el objeto crudo (sin envelope `{ data }`).
- Tiempo real: **polling** (no hay WebSocket). CORS abierto donde corresponde
  llamar desde el navegador.
- Identidad: usa **`npub`/`pubkey` como `playerId`**. Nunca generes un UUID local
  si después querés presencia, amigos, apuestas o rankings consistentes.

Antes de publicar nada, el juego se crea desde `__LUNA_NEGRA_BASE__/provider`
(datos, precio, imágenes y la URL donde vive tu juego). Ahí también se generan las
API keys y se configura el webhook.

---

## §1. Identidad y login SSO  ·  *(mínimo recomendado)*

El jugador **no crea otra cuenta**. Luna Negra abre tu juego con un pase temporal
en la URL: `https://tu-juego.com/?lnToken=<jwt>`. Tu juego lo canjea al cargar.

```ts
// En el cliente al arrancar el juego:
const lnToken = new URLSearchParams(location.search).get("lnToken");

const r = await fetch("__LUNA_NEGRA_BASE__/api/v1/session", {
  headers: { authorization: "Bearer " + lnToken },
});
const { npub, pubkey, displayName, avatarUrl, gameId, slug, gameCoord } = await r.json();
// Usá `npub` como identidad estable del jugador.
// `gameCoord` es la coordenada Nostr del juego (para el marcador 2.0, ver §6).
```

- **`GET /api/v1/session`** (Bearer entitlement) →
  `{ npub, pubkey, displayName, avatarUrl, gameId, slug, gameCoord }`.
  `gameCoord` es `30023:<tienda>:<slug>` (o `null` si el juego aún no se publicó).
  Errores: `400 MISSING_TOKEN`, `401 INVALID_TOKEN`.
- Después de canjearlo, **descarta el `lnToken` de la URL** (`history.replaceState`)
  para no dejarlo en logs/historial.
- Para refrescar nombre/avatar sin token: **`GET /api/v1/players/{npub}/profile`** (público).

---

## §2. Verificar compra (acceso a contenido pago)

Si tu juego es de pago, **verifica en tu backend** que el jugador realmente lo
compró antes de servir el contenido. Dos caminos:

**A) Offline con JWKS (recomendado, sin round-trip):**

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
const JWKS = createRemoteJWKSet(new URL("__LUNA_NEGRA_BASE__/.well-known/jwks.json"));
const { payload } = await jwtVerify(lnToken, JWKS, {
  issuer: "luna-negra",
  audience: "lunanegra:game",
});
// payload.scope === "entitlement"; payload.sub / payload.npub === jugador
```

**B) Online:** `GET /api/v1/entitlements/verify` (Bearer entitlement) →
`{ valid: true, npub, gameId, slug }` o `{ valid: false }`.

> El JWKS (`GET /.well-known/jwks.json`) se cachea 300 s. Verificar offline evita
> llamar a Luna Negra en cada request.

---

## §3. Presencia ("jugando X")

Reporta desde tu **game server** (API key) que un jugador está en partida; Luna
Negra lo muestra como "Jugando <tu juego>" en su perfil NIP-38.

- **`POST /api/v1/presence`** (API key) — heartbeat cada ~10 s, TTL ~30 s.
  - Body: `{ npub, status: "in-game" | "online", game?, roomId?, state? }`
  - `status` es la clave reservada (la usa Luna Negra). `state` es una **bolsa
    libre** (objeto plano ≤2 KB): puntaje, vidas, nivel… Cada latido la reemplaza.
  - **`game`** (opcional pero recomendado): el **slug** (o id) del juego en el que
    está el jugador. Mandalo si tu API key cubre **varios juegos**: con él la curva
    de "jugadores concurrentes" se cuenta **por juego**; sin él, todos tus juegos
    comparten la misma curva (la presencia queda a nivel proveedor). Si no matchea
    un juego tuyo, se ignora (cae a provider-wide).
  - `200 { ok: true }` · errores `INVALID_NPUB`/`INVALID_STATUS`/`STATE_TOO_LARGE`.
  - **`403 NOT_A_PLAYER`:** solo podés reportar presencia de un `npub` que tenga
    acceso a alguno de tus juegos. No podés marcar como "in-game" a usuarios ajenos.

> El juego **no toca Nostr**: solo reporta por REST y Luna Negra deriva la
> presencia. Nada de `window.opener` ni firmar eventos desde el cliente.

---

## §4. Multijugador: salas y estado compartido

Para juegos **sin backend propio**, Luna Negra hostea un "tablero común" por sala
(estilo `SetLobbyData` de Steam). El jugador entra con un `?inviteToken=…`.

- **`GET /api/v1/rooms/verify`** (Bearer invite) → identidad + contexto de sala:
  `{ valid, npub, pubkey, displayName, avatarUrl, gameId, slug, roomId, host, hostNpub, hostPubkey, expiresAt }`.
- **`POST /api/v1/rooms/{roomId}/presence`** (Bearer invite) — heartbeat + roster (~2 s).
  - Body: `{ clientId, score?, leave?, peek? }` → `{ members: [{ clientId, npub, host, score, name, avatar }], closed }`.
    `peek: true` lee el roster sin contar como heartbeat; `closed` indica si la sala expiró.
- **`POST /api/v1/rooms/{roomId}/state`** y **`GET …/state`** (Bearer invite) — estado compartido (TTL ~60 s; cada POST renueva la sala y actúa de heartbeat).
  - POST body: `{ set?, self?, version? }`
    - `set` (objeto ≤8 KB): mezcla en la bolsa **compartida**, *last-write-wins por clave*.
    - `self` (objeto ≤2 KB): reemplaza la bolsa **del propio jugador**.
    - `version`: concurrencia optimista; si no coincide → `409 VERSION_CONFLICT`.
  - GET → `{ data, version, members: [{ npub, name, avatar, state }] }`. Trae
    `ETag`: pollea con `If-None-Match` y recibí `304` si no cambió.

```ts
// Escribir estado del juego (ej. tres en raya)
await fetch("__LUNA_NEGRA_BASE__/api/v1/rooms/" + roomId + "/state", {
  method: "POST",
  headers: { authorization: "Bearer " + inviteToken, "content-type": "application/json" },
  body: JSON.stringify({ set: { turno: "x", tablero: ["x", null, "o"] }, self: { listo: true }, version: 3 }),
});
```

> Luna Negra **no interpreta** las claves del estado: su significado lo decide tu
> juego. La identidad sale del token (no la mandes en el body).

---

## §5. Invitaciones y amigos

Desde tu game server (API key) podés invitar amigos a una sala y leer su presencia.

- **`POST /api/v1/invites`** (API key) — `{ fromNpub, toNpub, roomId, inviteUrl, gameId? }`
  → `{ delivered, launchQueued }`. Luna Negra muestra el toast in-app al invitado.
- **`GET /api/v1/invites?npub=…`** (API key) — orden de entrada a sala pendiente (polling) → `{ request | null }`.
- **`GET /api/v1/friends`** (API key) — contactos NIP-02 con presencia en este juego.
  Query: `npub`, `presence=true`, `q=<texto>`. → `{ friends: [{ npub, displayName, avatarUrl, presence, roomId, state, lastSeenMs, isMember, lastPlayedAt, isFollow }] }`.
  Con `q`, la respuesta agrega `query`; si no hay match en los follows busca en todo Nostr (resultados externos con `isFollow: false`).

---

## §6. Marcadores (leaderboards)

Rankings por juego. El `name`/`board` lo elige tu juego (`semanal`, `clasico`,
`speedrun`…). Política: **se queda el mejor puntaje**. Hay **dos caminos** que
alimentan el **mismo ranking**; podés usar cualquiera (o ambos).

### Camino REST (1.0) — simple, depende de Luna Negra

- **`POST /api/v1/leaderboards/{name}/scores`** (Bearer entitlement) — `{ score }` (entero 0…1e9) → `{ score, rank, improved }`.
- **`GET /api/v1/leaderboards/{name}`** (Bearer entitlement) — query `window=all|week`, `view=top|around`, `npub` (para `around`) → `{ entries: [{ npub, displayName, score, rank }] }`.

### Camino Nostr (2.0) — *experimental, en construcción*: el juego firma su puntaje

> ⚠️ La interfaz **2.0 (Nostr)** es una mejora **experimental y no prometida**, trabajo
> **post-hackathon**. Para algo productivo hoy, usá el **Camino REST (1.0)** de arriba.
> Esto es un adelanto opcional para quien quiera resiliencia/interoperabilidad Nostr.


El jugador **firma su propio puntaje** como evento Nostr y lo publica a los relays.
Ventaja: el marcador vive en Nostr, sobrevive aunque Luna Negra caiga y lo puede
leer cualquier cliente Nostr. Luna Negra lo recoge solo (un sync lo proyecta al
mismo ranking que el camino REST). El juego **no llama a ninguna API** para esto.

Necesitás dos cosas que ya tenés del login (§1): la **pubkey del jugador** (firma
con NIP-07/46) y **`gameCoord`** (la coordenada del juego, de `GET /api/v1/session`).

```ts
// Publicar el mejor puntaje del jugador (firmado por él, NIP-07).
import { SimplePool } from "nostr-tools";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const board = "clasico"; // tu nombre de tabla

const evt = await window.nostr.signEvent({
  kind: 31337,                                  // evento de puntaje (addressable)
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", gameCoord],                           // ancla: 30023:<tienda>:<slug>
    ["d", `${gameCoord}:${board}`],             // 1 registro por jugador y tabla
    ["board", board],
    ["score", String(puntaje)],                 // entero, como string
    ["client", "tu-juego"],                     // opcional
  ],
  content: "",                                  // opcional: JSON con nivel, etc.
});
await Promise.any(new SimplePool().publish(RELAYS, evt));
```

Leer el ranking (cualquier cliente, sin Luna Negra): filtro Nostr
`{ kinds:[31337], "#a":[gameCoord], "#board":[board] }`, agrupás por `pubkey` y te
quedás con el mejor `score`. (También seguís pudiendo leerlo por el `GET` REST de
arriba: es el mismo ranking.)

> **Reglas del evento.** `a` = `gameCoord`. El `kind` 31337 es **addressable**: el
> `d` (`<gameCoord>:<board>`) hace que cada jugador tenga **un** récord por tabla,
> que se auto-reemplaza. Nombre de `board`: `^[a-z0-9][a-z0-9_-]{0,63}$` (no empieza
> con `_`/`-`). Ver `docs/perfil-juego-nostr.md` para la spec completa.

> ⚠️ **Anti-trampa.** El puntaje lo firma el **cliente del jugador** y es
> **falsificable** (vale para los dos caminos). Sirve para **mostrar** rankings,
> **no** para repartir dinero. El resultado de una apuesta SIEMPRE viene del game
> server por `/bets/{id}/result`.

---

## §7. Apuestas y escrow  ·  *(API key — server-to-server)*

Tu game server crea un pozo winner-takes-all; Luna Negra **custodia los depósitos**
en sats y paga a los ganadores (menos un fee configurable). El contrato (stake,
fee, participantes) se publica **firmado en Nostr**; antes de pagar, Luna Negra
recalcula el hash y, si los términos fueron alterados, **no paga**
(`CONTRACT_MISMATCH`).

```ts
// 1) Crear el pozo (desde tu backend, con API key)
POST /api/v1/bets
{ "gameId": "game_…", "participants": ["npub1…","npub1…"], "stakeSats": 10,
  "victoryCondition": "primero a 100", "roomId": "room-42", "metadata": { "matchId": "m-1" } }
// 201 → { betId, contractEventId, depositDeadline, potTargetSats, feeSats, netPayoutSats, … }
// Acepta `Idempotency-Key` (reintento seguro). Mín. 2 participantes.

// 2) Consultar estado + handles de pago en una llamada
GET /api/v1/bets/{id}
// status: pending_deposits | funded | settled | cancelled | expired | refunded
// Raíz: { betId, gameId, status, victoryCondition, depositDeadline, resolveDeadline,
//   stakeSats, potSats (depositado), potTargetSats, depositsReceived, depositsTotal,
//   feePct, feeBps, feeSats, netPayoutSats, participants, roomId, metadata,
//   contractEventId, resultEventId }
// participants[i] = { npub, depositStatus (pending|paid|refunded|failed),
//   result (pending|won|lost|tie), payoutStatus, payoutSats, bolt11, lnurl, payUrl,
//   depositError } — handles null si el depósito cerró; depositError != null si falló generar el invoice

// 3a) Resolver con la API key (recomendado, sin tocar Nostr)
POST /api/v1/bets/{id}/result   { "winners": ["npub1ganador…"] }   // [] = empate → reembolso total
// 3b) …o cancelar antes de resolver (reembolsa depósitos)
POST /api/v1/bets/{id}/cancel
```

- **Idempotente:** re-reportar una apuesta ya terminal devuelve `200 { ok: true, alreadyResolved: true, status }` sin volver a pagar.
- Reparto: un ganador → `netPayoutSats`; varios → partes iguales; sin ganadores → reembolso total sin comisión.
- El resultado puede venir por **API key** (Luna Negra firma con el oráculo
  gestionado) o por **evento Nostr firmado** por tu oráculo (avanzado).

---

## §8. Webhooks

Registra una URL y Luna Negra hace **POST JSON** (con reintentos) a tu backend
cuando pasa algo. Verifica la firma antes de confiar en el evento.

- **`POST /api/v1/provider/webhook`** (API key) — `{ url, regenerate? }` → `{ url, secret }`. `regenerate:true` rota el secreto; `url` vacía borra la config.
- **`GET /api/v1/provider/webhook`** (API key) → `{ url, secret }` (leé el secreto al arrancar el server).
- Cada evento llega con cabeceras `X-LunaNegra-Event` y `X-LunaNegra-Signature`
  (**HMAC-SHA256 del cuerpo crudo** con tu `whsec_…`). Cuerpo: `{ id, type, created, data }`.

| Evento | Cuándo |
|---|---|
| `purchase.completed` | un jugador compró tu juego |
| `deposit.received` | un participante depositó su stake |
| `bet.funded` | el pozo se completó |
| `bet.settled` | apuesta resuelta y pagada |
| `bet.cancelled` / `bet.expired` / `bet.refunded` | cancelación / vencimiento / reembolso |
| `payout.sent` | te enviamos tu parte de una compra |

```ts
// Verificar la firma (cuerpo CRUDO, no parseado):
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody: string, sig: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

---

## §9. SDK de TypeScript (atajo para game servers)

`@lunanegra/sdk` envuelve el contrato público (validación offline de tokens,
apuestas, webhooks, perfiles y actividad). Requiere `jose`.

```ts
npm i jose
import { createClient, verifyWebhook } from "@lunanegra/sdk";

const luna = createClient({
  baseUrl: "__LUNA_NEGRA_BASE__",
  apiKey: process.env.LUNA_NEGRA_API_KEY, // solo en el servidor
});

const ent  = await luna.verifyAccess(lnToken);          // entitlement | null
const room = await luna.verifyRoom(inviteToken);        // RoomInvite | null
const bet  = await luna.createBet({ gameId, participants, stakeSats: 10 });
const info = await luna.getBet(bet.betId);
await luna.reportWinners(bet.betId, [winnerNpub]);
await luna.postActivity(slug, "¡Nuevo récord en la sala 42!");
```

Métodos: `verifyAccess`, `verifyRoom`, `getPlayerProfile`, `createBet`, `getBet`,
`cancelBet`, `reportWinners`, `buildResultEvent`/`reportResult` (self-sign),
`postActivity`, `getWebhook`/`setWebhook`, `verifyWebhook`.

El código del SDK está en el repo de Luna Negra en `sdk/index.ts` (copialo a tu
proyecto si el paquete no está publicado en npm).

---

## Reglas de oro (errores comunes)

1. **La API key (`ln_sk_…`) nunca va al navegador.** Solo en tu game server. Todo
   lo de apuestas/presencia global/webhooks/amigos es server-to-server.
2. **`npub`/`pubkey` = identidad estable.** Úsalos como `playerId`. No inventes
   UUIDs locales.
3. **Verifica el acceso en el backend** antes de servir contenido pago (§2).
4. **El dinero lo decide el servidor.** Los marcadores y el estado de sala son
   falsificables por el cliente; el resultado de una apuesta SIEMPRE viene del
   game server por `/bets/{id}/result`.
5. **El juego no toca Nostr.** Reporta por REST; Luna Negra firma/publica.
6. **Tiempo real = polling.** Respeta los TTL y usa `ETag`/`If-None-Match` y
   `Idempotency-Key` donde estén disponibles.
7. **Descarta el `lnToken` de la URL** tras canjearlo.

---

## Checklist de integración

- [ ] Juego creado en `__LUNA_NEGRA_BASE__/provider` (con su URL y precio).
- [ ] §1 SSO: canjeo `?lnToken=` en `GET /api/v1/session` y guardo `npub`.
- [ ] §2 Acceso pago verificado en el backend (JWKS o `/entitlements/verify`).
- [ ] (opc.) §3 Presencia desde el game server.
- [ ] (opc.) §4 Salas + estado compartido con `?inviteToken=`.
- [ ] (opc.) §5 Invitaciones / amigos.
- [ ] (opc.) §6 Marcadores.
- [ ] (opc.) §7 Apuestas/escrow desde el backend.
- [ ] (opc.) §8 Webhook registrado y firma HMAC verificada.
- [ ] API key solo en el servidor; nada de secretos en el cliente.

## Dónde seguir

- Referencia interactiva: `__LUNA_NEGRA_BASE__/developers`
- Contrato OpenAPI (machine-readable): `__LUNA_NEGRA_BASE__/openapi.json`
- Guía humana: `__LUNA_NEGRA_BASE__/dev`
- JWKS público: `__LUNA_NEGRA_BASE__/.well-known/jwks.json`
