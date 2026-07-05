---
name: integrar-luna-negra-1-0
description: >-
  Integra juegos con la interfaz Luna Negra 1.0 REST estable: SSO con lnToken,
  verificación de compra/JWKS, presencia server-to-server, salas con estado
  compartido, invitaciones, amigos, Luna Room Link, leaderboards REST,
  apuestas/escrow REST v1, webhooks y SDK TypeScript. Usar cuando el usuario pida
  integrar un juego con Luna Negra, cobrar o apostar en sats/Lightning, validar
  acceso pago, usar API keys, salas, presencia, amigos, marcadores REST,
  webhooks o el SDK. Para Nostr Games Protocol (NGP) y apuestas v2 por zaps usar
  integrar-ngp-v2.
---

# Integrar juegos con Luna Negra 1.0

Luna Negra 1.0 es la interfaz REST productiva de la tienda: identidad, acceso,
pagos, presencia, salas, invitaciones, marcadores, apuestas y webhooks. El juego
sigue viviendo en su propia URL; Luna Negra lo abre con un pase temporal y el
juego llama HTTP estándar a la plataforma.

Esto es un menú, no un contrato todo-o-nada. El mínimo útil es la identidad SSO.
No implementes apuestas, webhooks o salas si el usuario no los pidió.

## Cómo trabajar

1. Pregunta qué bloque quiere integrar: identidad, compra, presencia, salas,
   invitaciones, Luna Room Link, marcadores, apuestas, webhooks o SDK.
2. Averigua la base URL del deploy de Luna Negra. En esta skill aparece como
   `__LUNA_NEGRA_BASE__`; si sigue como placeholder, pregunta por el deploy
   real. El oficial es `https://luna.naranja.fit`, pero puede haber self-hosting.
3. Identifica el stack del juego: navegador, backend Node/Go/Python, Unity,
   Godot u otro. Las llamadas son HTTP; adapta `fetch` al lenguaje.
4. Respeta cliente/servidor: la API key `ln_sk_...` nunca va al navegador.
5. Implementa solo el bloque elegido y prueba contra
   `__LUNA_NEGRA_BASE__/developers` y `__LUNA_NEGRA_BASE__/openapi.json`.

## Conceptos base

| Concepto | Qué es | Detalle técnico |
|---|---|---|
| Proveedor | Estudio/equipo en Luna Negra | Owner que crea juegos, API keys, webhooks y recibe payouts |
| Juego | Experiencia publicada | Tiene `gameId`, `slug`, precio, URL y assets |
| Jugador | Usuario que compra o entra | Identidad Nostr estable: `npub` y `pubkey` |
| Entitlement | Pase temporal de acceso | JWT ES256 que llega como `?lnToken=...` |
| Invite token | Pase a una sala de Luna | JWT ES256 que llega como `?inviteToken=...` |
| Room Link | Sala hosteada por el juego | `?lnRoom=<id>` en el dominio del juego |
| `lnInvite` | Autorización dirigida a un `npub` para `lnRoom` | JWT ES256 opcional, `scope:"room-invite"` |
| API key | Llave server-to-server | `ln_sk_...`, secreta, solo backend |
| Webhook secret | Firma de webhooks | `whsec_...` para HMAC |

Convenciones estables bajo `/api/v1`:

- Autenticación: `Authorization: Bearer <token-o-api-key>`.
- Dinero: enteros en sats. Fechas: ISO 8601.
- Errores: `{ "error": { "code", "message" } }` con status HTTP correcto.
- Éxito: objeto crudo, sin envelope `{ data }`.
- Tiempo real: polling. Usa TTL, `ETag` e `If-None-Match` donde existan.
- Identidad: usa `npub`/`pubkey` como `playerId`; no inventes UUIDs locales.

Antes de publicar, el juego se crea desde `__LUNA_NEGRA_BASE__/provider`. Ahí se
configuran datos, precio, imágenes, URL, API keys y webhook.

## 1. Identidad SSO

Luna Negra abre el juego con `?lnToken=<jwt>`. El juego lo canjea al cargar.

```ts
const lnToken = new URLSearchParams(location.search).get("lnToken");

const r = await fetch("__LUNA_NEGRA_BASE__/api/v1/session", {
  headers: { authorization: "Bearer " + lnToken },
});

const { npub, pubkey, displayName, avatarUrl, gameId, slug, gameCoord } =
  await r.json();
```

`GET /api/v1/session` devuelve `{ npub, pubkey, displayName, avatarUrl, gameId,
slug, gameCoord }`. `gameCoord` es `30023:<tienda>:<slug>` o `null` si el juego
aún no se publicó.

Después del canje, descarta el token de la URL:

```ts
history.replaceState(null, "", location.pathname + location.hash);
```

Para refrescar perfil sin token, usa `GET /api/v1/players/{npub}/profile`.

## 2. Verificar compra

Si el juego es de pago, valida el acceso en el backend antes de servir contenido.

Opción offline recomendada:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("__LUNA_NEGRA_BASE__/.well-known/jwks.json"),
);

const { payload } = await jwtVerify(lnToken, JWKS, {
  issuer: "luna-negra",
  audience: "lunanegra:game",
});

// payload.scope === "entitlement"; payload.sub / payload.npub === jugador
```

Opción online: `GET /api/v1/entitlements/verify` con Bearer entitlement devuelve
`{ valid: true, npub, gameId, slug }` o `{ valid: false }`.

El JWKS se cachea 300 s. Verificar offline evita llamar a Luna Negra en cada
request.

## 3. Presencia

Reporta desde el game server, con API key, que el jugador está en partida.

`POST /api/v1/presence`

```json
{ "npub": "npub1...", "status": "in-game", "game": "mi-slug", "roomId": "r1", "state": { "score": 42 } }
```

Detalles:

- Heartbeat recomendado: cada 10 s. TTL aproximado: 30 s.
- `status`: `"in-game"` u `"online"`.
- `game`: slug o id del juego. Úsalo si una API key cubre varios juegos.
- `state`: objeto plano libre de hasta 2 KB. Cada latido lo reemplaza.
- Respuesta: `200 { ok: true }`.
- `403 NOT_A_PLAYER`: solo puedes reportar presencia de usuarios con acceso a
  alguno de tus juegos.

En 1.0 el juego no toca Nostr para presencia; reporta REST y Luna Negra deriva
lo visible.

## 4. Salas y estado compartido

Para juegos sin backend propio, Luna Negra hostea un estado común por sala. El
jugador entra con `?inviteToken=...`.

`GET /api/v1/rooms/verify` con Bearer invite devuelve identidad y sala:

```ts
{
  valid, npub, pubkey, displayName, avatarUrl,
  gameId, slug, roomId, host, hostNpub, hostPubkey, expiresAt
}
```

`POST /api/v1/rooms/{roomId}/presence` mantiene roster:

```json
{ "clientId": "tab-1", "score": 10 }
```

Devuelve `{ members: [{ clientId, npub, host, score, name, avatar }], closed }`.
Usa `peek:true` para leer sin heartbeat y `leave:true` para salir.

`POST /api/v1/rooms/{roomId}/state` y `GET /api/v1/rooms/{roomId}/state`
mantienen estado compartido:

```ts
await fetch("__LUNA_NEGRA_BASE__/api/v1/rooms/" + roomId + "/state", {
  method: "POST",
  headers: {
    authorization: "Bearer " + inviteToken,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    set: { turno: "x", tablero: ["x", null, "o"] },
    self: { listo: true },
    version: 3,
  }),
});
```

`set` mezcla hasta 8 KB en la bolsa compartida. `self` reemplaza hasta 2 KB del
propio jugador. `version` permite concurrencia optimista y puede devolver
`409 VERSION_CONFLICT`. El `GET` trae `ETag`; pollea con `If-None-Match`.

## 5. Invitaciones y amigos

Desde el game server, con API key:

- `POST /api/v1/invites`: `{ fromNpub, toNpub, roomId, inviteUrl, gameId? }`
  devuelve `{ delivered, launchQueued }`.
- `GET /api/v1/invites?npub=...`: lee una orden pendiente de entrada a sala y
  devuelve `{ request | null }`.
- `GET /api/v1/friends?npub=...&presence=true&q=...`: contactos NIP-02 con
  presencia en el juego.

Respuesta de amigos:

```ts
{
  friends: [{
    npub, displayName, avatarUrl, presence, roomId, state,
    lastSeenMs, isMember, lastPlayedAt, isFollow
  }]
}
```

Con `q`, si no hay match en follows busca en todo Nostr y marca
`isFollow:false`.

## 6. Luna Room Link

Usa este bloque cuando la sala vive en el backend del juego, pero Luna Negra debe
crear o compartir el enlace desde la ficha. El enlace va al dominio del juego:

```text
https://tu-juego.com/?lnRoom=<roomId>[&lnInvite=<jwt>]
```

Contrato del juego:

1. Lee `lnRoom`. Si falta, arranque normal.
2. Si hay `lnRoom` pero no `lnToken`, redirige a Luna SSO preservando la URL:

   ```js
   const here = new URL(location.href);
   if (here.searchParams.get("lnRoom") && !here.searchParams.get("lnToken")) {
     const returnTo = encodeURIComponent(here.toString());
     location.replace("__LUNA_NEGRA_BASE__/launch/<slug>?returnTo=" + returnTo);
   }
   ```

3. Con `lnToken`, verifica identidad offline vía JWKS.
4. Si hay `lnInvite`, verifica su firma vía JWKS y exige `jugador == toNpub`.
   El token es autocontenido: `scope:"room-invite"`, `gameId`, `slug`,
   `roomId`, `toNpub`.
5. Si `lnRoom` no existe en el backend del juego, créala lazy; host = primero
   en entrar. Si existe, une al jugador.
6. Descarta `lnToken`/`lnInvite` de la URL.

Declara la capacidad "Invitar a sala / Luna Room Link" en el panel de integración
para que Luna muestre el botón. El enlace público no debe contener secretos.

## 7. Marcadores REST

Rankings por juego. El nombre del tablero lo elige el juego: `semanal`,
`clasico`, `speedrun`, etc. Política: se queda el mejor puntaje.

- `POST /api/v1/leaderboards/{name}/scores` con Bearer entitlement y
  `{ score }` devuelve `{ score, rank, improved }`.
- `GET /api/v1/leaderboards/{name}` con Bearer entitlement acepta
  `window=all|week`, `view=top|around` y `npub` para `around`.

El puntaje del cliente es falsificable. Úsalo para rankings sociales, no para
repartir dinero.

## 8. Apuestas y escrow

El game server crea un pozo winner-takes-all. Luna Negra custodia depósitos en
sats y paga ganadores menos fee configurable.

```ts
// Crear pozo desde backend con API key.
POST /api/v1/bets
{
  "gameId": "game_...",
  "participants": ["npub1...", "npub1..."],
  "stakeSats": 10,
  "victoryCondition": "primero a 100",
  "roomId": "room-42",
  "metadata": { "matchId": "m-1" }
}

// Consultar estado.
GET /api/v1/bets/{id}

// Resolver o cancelar.
POST /api/v1/bets/{id}/result { "winners": ["npub1ganador..."] }
POST /api/v1/bets/{id}/cancel
```

Invariantes:

- Mínimo 2 participantes.
- Usa `Idempotency-Key` para reintentos seguros.
- Resolver una apuesta terminal devuelve `alreadyResolved`.
- Un ganador recibe `netPayoutSats`; varios dividen partes iguales; sin ganador
  es empate y reembolso total sin comisión.
- El resultado siempre viene del game server o de un oráculo controlado; nunca
  de un marcador cliente.
- Si el usuario pide apuestas v2 por zaps o `/api/v2/bets`, usa la skill
  `integrar-ngp-v2`.

## 9. Webhooks

Registra una URL para recibir eventos JSON con reintentos:

- `POST /api/v1/provider/webhook` con API key:
  `{ url, regenerate? }` devuelve `{ url, secret }`.
- `GET /api/v1/provider/webhook` devuelve `{ url, secret }`.

Cada evento trae `X-LunaNegra-Event` y `X-LunaNegra-Signature`. La firma es HMAC
SHA-256 del cuerpo crudo con `whsec_...`.

Eventos:

| Evento | Cuándo |
|---|---|
| `purchase.completed` | compra completada |
| `deposit.received` | participante depositó stake |
| `bet.funded` | pozo completado |
| `bet.settled` | apuesta resuelta y pagada |
| `bet.cancelled` / `bet.expired` / `bet.refunded` | cierre sin payout normal |
| `payout.sent` | payout al proveedor |

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, sig: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## 10. SDK TypeScript

`@lunanegra/sdk` envuelve validación offline, salas, apuestas, webhooks, perfiles
y actividad. Requiere `jose`.

```ts
npm i jose

import { createClient, verifyWebhook } from "@lunanegra/sdk";

const luna = createClient({
  baseUrl: "__LUNA_NEGRA_BASE__",
  apiKey: process.env.LUNA_NEGRA_API_KEY,
});

const ent = await luna.verifyAccess(lnToken);
const room = await luna.verifyRoom(inviteToken);
const roomLink = await luna.verifyRoomInvite(lnInvite);
const bet = await luna.createBet({ gameId, participants, stakeSats: 10 });
const info = await luna.getBet(bet.betId);
await luna.reportWinners(bet.betId, [winnerNpub]);
await luna.postActivity(slug, "Nuevo récord en la sala 42");
```

Métodos principales: `verifyAccess`, `verifyRoom`, `verifyRoomInvite`,
`getPlayerProfile`, `createBet`, `getBet`, `cancelBet`, `reportWinners`,
`buildResultEvent`, `reportResult`, `postActivity`, `getWebhook`, `setWebhook`,
`verifyWebhook`.

Si el paquete no está publicado en npm, copia `sdk/index.ts` del repo.

## Reglas de oro

1. La API key `ln_sk_...` nunca va al navegador.
2. `npub`/`pubkey` son la identidad estable; no inventes IDs locales.
3. Verifica acceso pago en backend.
4. El dinero lo decide el servidor; no un marcador cliente.
5. En 1.0 el juego usa REST; no necesita firmar eventos Nostr.
6. Tiempo real es polling; respeta TTL, `ETag`, `If-None-Match` e
   `Idempotency-Key`.
7. Descarta tokens de la URL tras canjearlos.

## Checklist

- [ ] Juego creado en `__LUNA_NEGRA_BASE__/provider`.
- [ ] SSO: canjear `?lnToken=` en `GET /api/v1/session`.
- [ ] Acceso pago verificado en backend.
- [ ] API key guardada solo en backend.
- [ ] Presencia opcional por `/api/v1/presence`.
- [ ] Salas opcionales por `/api/v1/rooms`.
- [ ] Invitaciones/amigos opcionales por `/api/v1/invites` y `/api/v1/friends`.
- [ ] Luna Room Link opcional con `?lnRoom=`.
- [ ] Marcadores REST opcionales.
- [ ] Apuestas/escrow opcionales desde backend.
- [ ] Webhook opcional con firma HMAC.

## Dónde seguir

- Referencia interactiva: `__LUNA_NEGRA_BASE__/developers`
- Contrato OpenAPI: `__LUNA_NEGRA_BASE__/openapi.json`
- Guía humana: `__LUNA_NEGRA_BASE__/dev`
- JWKS público: `__LUNA_NEGRA_BASE__/.well-known/jwks.json`
