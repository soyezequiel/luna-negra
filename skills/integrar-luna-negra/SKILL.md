---
name: integrar-luna-negra
description: >-
  Guía completa y modular para hacer compatible un juego con Luna Negra
  (tienda de juegos con identidad Nostr y pagos Lightning/sats). Cubre login SSO,
  verificación de compra, presencia "jugando X", salas multijugador con estado
  compartido, invitaciones, amigos, marcadores, apuestas/escrow, webhooks y el
  SDK de TypeScript. Usar cuando el usuario quiere integrar su juego con Luna
  Negra, agregar login con Nostr, cobrar/apostar en sats o Lightning, hacer
  multijugador, presencia, invitaciones o marcadores. Incluye además una capa 2.0
  opcional y experimental sobre eventos Nostr (login NIP-07/46, presencia NIP-38,
  reto/invitación NIP-17, marcador kind:31337, zaps NIP-57, reseñas NIP-23). No
  hace falta aplicar todo: cada bloque es independiente y se adopta por separado.
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
   **Por defecto, integrá con la 1.0 REST (§1–§8): es lo estable y garantizado.** La
   capa 2.0 (Nostr) es experimental y opcional — proponela solo si el usuario quiere
   resiliencia/interoperabilidad Nostr, y nunca para escrow (§7) ni pago (§2).
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
| **Invite token** | Pase a una sala de Luna (§4) | JWT ES256 que llega como `?inviteToken=…` |
| **Room Link** (`lnRoom`) | Enlace a una sala hosteada por **tu** juego (§5·bis) | `?lnRoom=<id>` en tu dominio; la sala la crea tu juego *lazy* |
| **`lnInvite`** | Autorización dirigida a un `npub` para un `lnRoom` | JWT ES256 opcional (`scope:"room-invite"`); sin él, el enlace es público |
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

## §5·bis. Luna Room Link: salas hosteadas por **tu** juego  ·  *(opt-in)*

A diferencia de §4 (Luna hostea el tablero), acá **el estado de la sala vive en tu
backend**. Luna solo arma el enlace y resuelve la identidad. Sirve para que alguien
invite a jugar **desde la ficha de Luna, sin abrir el juego primero**, y que la sala
**no tenga que pre-existir** (tu juego la crea *lazy*). El enlace lleva **tu dominio**
(`Game.gameUrl`), no el de Luna. Ver `docs/luna-room-link.md`.

**Enlace canónico** (lo genera Luna, o tu juego):

```
https://tu-juego.com/?lnRoom=<roomId>[&lnInvite=<jwt>]
```

- `lnRoom` — id de sala opaco (`^[A-Za-z0-9_-]{1,64}$`). **No pre-existe.**
- `lnInvite` — *(opcional)* JWT ES256 firmado por Luna que autoriza a **un** `npub`
  (variante **dirigida**). Sin él = enlace **público** (cualquiera entra).
- `lnToken` — el entitlement de identidad (§1). **No viaja en el enlace compartible**;
  se adjunta en el handoff (abajo).

> `lnRoom` es **distinto** de `?room=`+`?inviteToken=` de §4 (salas de Luna). Podés
> soportar ambos; este contrato es solo para `lnRoom`.

**Contrato del juego (6 pasos).** Al cargar:

1. Leé `lnRoom`. Si falta → arranque normal (no hay sala).
2. Si hay `lnRoom` pero **no** `lnToken` (enlace crudo reenviado por WhatsApp/Discord)
   → **rebotá a Luna SSO** preservando tu URL, y volvé a empezar al regresar:
   ```js
   const here = new URL(location.href);
   if (here.searchParams.get("lnRoom") && !here.searchParams.get("lnToken")) {
     const returnTo = encodeURIComponent(here.toString());
     location.replace("__LUNA_NEGRA_BASE__/launch/<slug>?returnTo=" + returnTo);
   }
   ```
   Luna autentica (o reusa la sesión), mintea un `lnToken` fresco y **te redirige de
   vuelta** con `lnToken` + `lnRoom` intactos.
3. Con `lnToken`: verificá identidad **offline** vía JWKS (igual que §1/§2).
4. Si hay `lnInvite`: verificá su firma vía JWKS y **exigí `jugador == toNpub`**
   (claim del token); si no coincide, rechazá o degradá a espectador. El `lnInvite`
   es autocontenido (`scope:"room-invite"`, claims `gameId`/`slug`/`roomId`/`toNpub`):
   **no** llames a ningún endpoint para validarlo (con el SDK §9:
   `await luna.verifyRoomInvite(lnInvite)`).
5. **Si la sala `lnRoom` no existe en tu backend → creala** (host = el primero en
   entrar); si existe → unite.
6. **Descartá los params de la URL** (`history.replaceState`) para no dejar tokens en
   el historial.

**Declaralo en el panel de integración** (capacidad "Invitar a sala / Luna Room
Link"): solo así Luna muestra el botón **"Invitar"** en tu ficha. Luna no puede
verificar estos 6 pasos, así que confía en tu declaración.

> **Seguridad.** El enlace público = cualquiera entra: no pongas secretos en
> `lnRoom` (es un id opaco). El `lnInvite` autoriza **entrada a sala**, nada de
> dinero (los premios siguen en §7). Luna valida `returnTo` contra tu `Game.gameUrl`
> antes de redirigir (anti open-redirect).

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

### §7·bis. Apuestas v2 por zaps (NIP-57)  ·  *experimental, opt-in*

> ⚠️ **Experimental y conviven las dos.** La v2 es una variante de este mismo escrow
> donde **todo el dinero se mueve por zaps NIP-57 públicos** anclados al contrato en
> Nostr (depósitos, premio, corte de la casa y del dev). **Sigue siendo custodial y
> server-to-server** —Luna Negra retiene el pozo y vos creás/resolvés con la API key
> igual que en la 1.0—; lo nuevo es el **riel** (zaps) y que **cada movimiento queda
> auditable en relays**. Para algo productivo hoy usá la **§7 (v1)**; la v2 es opt-in
> y puede estar apagada en el deploy (flag `BETS_V2_ENABLED`). No la asumas
> disponible: si `POST /api/v2/bets` da `503 BETS_V2_DISABLED`, este deploy no la tiene.

**Desde tu game server no cambia casi nada.** Mismo flujo que §7 bajo `/api/v2/bets`:

```ts
POST /api/v2/bets            // mismo body que v1
// 201 → { betId, apiVersion: 2, anchorEventId, depositDeadline, potTargetSats,
//         feeSats, netPayoutSats, participants: [{ seat, npub, participantId }], … }
GET  /api/v2/bets/{id}       // status igual que v1 + anchorEventId, y por participante
                             //   { participantId, depositStatus, depositReceiptId,
                             //     payoutStatus, payoutKind, payoutReceiptId, lnurl, payUrl }
POST /api/v2/bets/{id}/result   { "winners": ["npub1…"] }   // [] = empate → reembolso
POST /api/v2/bets/{id}/cancel
```

**La diferencia está en el depósito: lo paga el JUGADOR con un zap** (no un invoice
LNURL plano). Dos formas de que deposite:

- **Sin construir UI:** mandá al jugador a la página de Luna Negra
  `__LUNA_NEGRA_BASE__/apuestas/{betId}` (firma el zap, paga con NWC/extensión/QR y ve
  el estado). Es lo más simple.
- **UI propia (sesión del jugador, no API key):** `POST /api/v2/bets/{id}/deposit/prepare`
  → 9734 sin firmar; el jugador lo firma (NIP-07/46) y `POST …/deposit/invoice` con
  `{ signedZapRequest }` → `{ invoice }`; pollea `GET /api/v2/bets/{id}/mine` hasta
  `depositStatus: "paid"`. También hay un LNURL-pay por asiento en el `lnurl` que trae
  el `GET` (pagable desde cualquier wallet).

**Auditabilidad:** el `anchorEventId` es el contrato (kind:1) en Nostr; cada depósito
tiene su recibo `kind:9735` (`depositReceiptId`), y al liquidar se publica una **nota
de liquidación** con ganadores, montos y recibos. Abrí cualquiera con `njump.me/<id>`.

Webhooks: los mismos eventos que §8 con `apiVersion: 2` y `anchorEventId` en `data`
(no tenés que re-mapear tipos). El resultado y los invariantes (contrato firmado,
`CONTRACT_MISMATCH`, idempotencia, reembolso en empate/timeout) son **idénticos a v1**.

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
const room = await luna.verifyRoom(inviteToken);        // RoomInvite | null  (§4)
const rl   = await luna.verifyRoomInvite(lnInvite);     // RoomLinkInvite | null  (§5·bis)
const bet  = await luna.createBet({ gameId, participants, stakeSats: 10 });
const info = await luna.getBet(bet.betId);
await luna.reportWinners(bet.betId, [winnerNpub]);
await luna.postActivity(slug, "¡Nuevo récord en la sala 42!");
```

Métodos: `verifyAccess`, `verifyRoom`, `verifyRoomInvite`, `getPlayerProfile`, `createBet`, `getBet`,
`cancelBet`, `reportWinners`, `buildResultEvent`/`reportResult` (self-sign),
`postActivity`, `getWebhook`/`setWebhook`, `verifyWebhook`.

El código del SDK está en el repo de Luna Negra en `sdk/index.ts` (copialo a tu
proyecto si el paquete no está publicado en npm).

---

## Interfaz 2.0 (Nostr-nativa)  ·  *experimental, no prometida*

> ⚠️ Todo lo de esta sección es una mejora **experimental post-hackathon**: `kind`
> propuestos que **pueden cambiar** y, salvo el **marcador (kind:31337)** y el
> **reto 1v1 (NIP-17)**, es **diseño, no código**. **Lo garantizado hoy es la 1.0
> REST (§1–§8).** Implementá la 2.0 solo si querés resiliencia/interoperabilidad
> Nostr — **nunca** como reemplazo de lo que necesita custodia (escrow §7) o
> verificación de pago (§2): eso se queda siempre en la 1.0.

La 2.0 cubre la **misma capa social/identidad/reputación** que partes de la 1.0,
pero con **eventos Nostr firmados** en vez de REST: lo que publica el juego/jugador
lo lee cualquier cliente Nostr y sobrevive aunque Luna Negra caiga. Anclas:
**identidad del juego** = su coordenada `gameCoord` (`30023:<tienda>:<slug>`, viene
de `GET /api/v1/session`, §1); **identidad del jugador** = su `pubkey` (firma con
NIP-07/46). El **dinero y la custodia se quedan en la 1.0**.

| Capacidad | 1.0 (REST) | 2.0 (Nostr) | Estado 2.0 |
|---|---|---|---|
| Identidad | §1 SSO (`lnToken`) | login NIP-07/46 | disponible |
| Marcador | §6 leaderboards | `kind:31337` (ver §6) | implementado |
| Presencia | §3 REST | NIP-38 (`kind:30315`) | implementado |
| Salas / estado | §4 REST | grupo NIP-29 + jugadas | diseño |
| Invitación / reto | §5 invites | NIP-17 (gift-wrap) | reto 1v1 implementado |
| Reseñas / logros | — | NIP-23 / `kind:1` | implementado |
| Propinas / premios | — | zaps NIP-57 | implementado |
| Marcador verificado | — | `kind:31338` (oráculo) | diseño |

### Marcador (kind:31337)
Es la **única pieza nueva que la spec define** (el resto reusa NIPs estándar). Ya
está documentada arriba en **§6 → Camino Nostr (2.0)**: el jugador firma su puntaje
y Luna Negra lo proyecta al mismo ranking que el camino REST.

### Presencia "jugando X" (NIP-38) · *implementado*
En vez de reportar por REST (§3), el **propio jugador** firma su estado (no hace
falta game server):

```jsonc
{ "kind": 30315,
  "tags": [["d", "general"], ["a", gameCoord], ["expiration", "<unix + ~60s>"]],
  "content": "Jugando Pac-Toshi" }
```

Luna Negra y cualquier cliente derivan "Jugando X" del evento. **El `content` va
"pelado"** (sin emoji/prefijo): la tienda antepone su propio ícono al mostrarlo, así
que si lo incluís queda duplicado. **Cada heartbeat es una firma** (con bunker NIP-46
= un prompt al usuario): no firmes en cada latido, re-firmá solo si cambió el estado
o pasaron ~2 min, y poné un `expiration` mayor que tu intervalo (ver *Gotchas de la
2.0* más abajo).

### Invitación / reto 1v1 (NIP-17) · *reto implementado*
En la 2.0 **la invitación ES el reto**: un DM cifrado (gift-wrap NIP-17) que solo
*apunta* a un juego (y opcionalmente a una sala), **sin token de acceso**. El rumor
interno es un `kind:14`:

```jsonc
{ "kind": 14, "pubkey": "<retador>",
  "tags": [["p", "<invitado>"], ["game", gameCoord],
           ["room", "<groupId>", "wss://relay…"],   // opcional (omitir = 1v1 puro)
           ["url", "https://tu-juego.com/?room=…"], ["expiration", "<unix>"]],
  "content": "¡Te reto a una partida! 🎲" }
```

Va **cifrado E2E** (el server no lo puede leer). Para que la partida arranque, tu
juego debe **detectar que lo abrieron desde un reto y emparejar a los dos
jugadores**. En el panel de integración esto es "Invitaciones y amigos"; declarás el
soporte con el toggle de retos 1v1. Para 1v1 puro omitís `room` (no necesita relay
NIP-29). Necesita un signer con **NIP-44** (extensión moderna o clave local).

**Recibir el reto (lado invitado).** El reto llega como gift-wrap `kind:1059` con
`#p`=tu pubkey; tu juego se suscribe a esos eventos, desenvuelve las tres capas
(gift-wrap → seal `kind:13` → rumor `kind:14`) y verifica que el autor del rumor sea
quien firmó el seal (anti-suplantación NIP-59). **Punto crítico que rompe la entrega:
publicá y escuchá en el MISMO conjunto de relays.** El emisor publica en la bandeja
NIP-17 del destinatario = tu **fallback de relays de DM ∪ los `kind:10050` del
invitado**; si tu receptor escucha solo un set fijo e ignora los `kind:10050` propios
del usuario, el reto aterriza en la bandeja que el invitado declaró en OTRO cliente
(Amethyst/Damus) y tu juego **nunca lo lee** (dice "reto enviado" pero no llega). Usá
**la misma función de resolución de relays en los dos lados**. Ver *Gotchas de la 2.0*
#8.

### Salas con estado (NIP-29) · *diseño*
Para juegos **por turnos determinísticos**, la sala es un grupo NIP-29 (un relay
*group-aware* ordena los eventos y controla el acceso por membresía) y **cada
jugada es un evento firmado** (`kind:9421` propuesto, tags `h`=groupId,
`a`=gameCoord, `seq`/`prev`); el estado se reconstruye plegando las jugadas. Tiempo
real, info oculta y azar quedan **fuera** (usá la 1.0 §4 o un árbitro). Niveles de
adopción: **M0** reto 1v1 (NIP-17, sin sala) → **M1** sala por turnos → **M2**
snapshots.

### Reseñas y logros (NIP-23 / kind:1) · *implementado*
Reseñas, comentarios y logros cuelgan de la coordenada del juego: un **`kind:1` con
tag `a`=gameCoord**. Luna Negra ya los lee y muestra; cualquier cliente Nostr
también. Del lado del juego **con publicar alcanza** (firmar el `kind:1` y mandarlo a
los relays): las reseñas aparecen en la ficha de la tienda sin que construyas UI de
lectura. Solo agregá una vista propia si querés mostrarlas *dentro* del juego.

### Propinas y premios (zaps NIP-57) · *implementado*
Para juegos gratis o premiar al ganador: **zap** (NIP-57) firmado por el usuario al
dev o al ganador. Los recibos (`kind:9735`) verificados alimentan el "top de
zappers" por juego y por dev. Es NIP-57 estándar; no requiere nada propio de Luna
Negra. **Alternativa:** si ya cobrás por Lightning con la 1.0, podés dejar los premios
en la **1.0 REST** (§7 escrow / payout) y saltarte NIP-57 — elegí una sola vía para
no duplicar el flujo de dinero. Si querés **apuestas** (no propina) con la plata
moviéndose por zaps públicos pero manteniendo custodia, eso es la **§7·bis (apuestas
v2)**, no esta sección: acá el zap lo firma el usuario sin escrow; allá Luna Negra
custodia el pozo y liquida.

### Marcador verificado por oráculo (kind:31338) · *diseño*
Para rankings con dinero: un oráculo (tu game server, o Luna Negra) co-firma una
**atestación** que referencia el score del jugador (`kind:31338` propuesto, tags
`a`=gameCoord, `e`=id del evento de score, `p`=jugador, `status: verified|rejected`).
Conviven un **tier abierto** (firmado por el jugador, social, falsificable) y un
**tier verificado** (firmado por el oráculo, para stakes) — enlaza con el escrow 1.0
(§7).

> Spec completa de la 2.0: `docs/perfil-juego-nostr.md` y
> `docs/perfil-juego-nostr-salas-invitaciones.md` en el repo de Luna Negra.

### Gotchas de la 2.0 (no repitas estos errores)

Errores reales que costaron horas al integrar la 2.0. Leelos **antes** de publicar
cualquier evento anclado al juego (presencia, marcador, reseñas):

1. **El `gameCoord` real ≠ un placeholder.** El `a` tag debe ser el coord REAL
   `30023:<pubkeyDeLaTienda>:<slug>`, no un `30023:tu-juego:tu-juego` inventado.
   Sacalo de `GET /api/v1/session` (§1) o consultando el `kind:30023` real en relays
   (`{ kinds:[30023], "#d":["<slug>"] }`). Ojo: el **`slug` no es el nombre visible**
   del juego (suele diferir). Si el `a` tag no matchea el coord real, **Luna filtra
   por coord y no encuentra nada — 0 matches, sin ningún error** ("publico presencia
   pero no me detecta"). Verificá el round-trip: publicá y buscá con el mismo filtro
   `#a` que usa la tienda.
2. **No publiques a relays de solo lectura.** Algunos relays son indexadores
   read-only (p.ej. `relay.nostr.band`) y **rechazan escrituras en silencio**. Mantené
   una lista de relays de ESCRITURA separada de los de lectura/perfiles, o el evento
   parece publicado pero no queda en ninguno.
3. **Cada latido de presencia es una FIRMA.** Con bunker NIP-46 eso dispara un prompt
   al usuario cada vez. Throttleá: re-firmá solo si **cambió el estado** o pasaron
   **~2 min**, y sellá el "último publicado" solo en publicación exitosa. El
   `expiration` debe ser mayor que tu intervalo de heartbeat (latís cada 10s → TTL
   ~60–240s) o la presencia titila.
4. **No metas emoji/prefijo en el `content`** si la tienda ya lo antepone: queda
   duplicado. Publicá el estado "pelado" ("Jugando TETRA") y dejá que el cliente lo
   decore.
5. **Leer contactos/perfiles a escala es frágil** (reto NIP-17 o cualquier lista de
   amigos): (a) leé el `kind:3`/`kind:10002` también de los relays de ESCRITURA del
   usuario (modelo **outbox**, tags `r`), no solo de tu set fijo; (b) traé los
   `kind:0` en **lotes (~100)** en paralelo — una sola sub con cientos de autores
   pierde eventos (~límite 500/sub); (c) **no truncar la lista de follows** por debajo
   de lo que la gente realmente sigue.
6. **Lado tienda: aceptá eventos anclados por coord.** Si mantenés Luna, el riel que
   consume presencia/marcador debe aceptar el evento por su tag `a`=coord (verificando
   que el coord lo firme tu tienda), **no** exigir una etiqueta privada propia
   (`l:"luna-negra"`) que solo pone la tienda: la presencia 2.0 la firma el juego y
   nunca lleva esa etiqueta.
7. **Los `board`/tablas del `kind:31337` deben coincidir con las del camino REST §6**
   (mismo nombre y mismas unidades — p.ej. `victorias`, o ms para tiempo) o
   alimentarán un ranking distinto en vez de fusionarse.
8. **NIP-17: publicá y escuchá en el MISMO set de relays, o el reto se pierde en
   silencio.** El emisor debe publicar el gift-wrap en la bandeja del destinatario =
   *tu fallback de DM ∪ los `kind:10050` del destinatario*, y el receptor debe
   suscribirse a **exactamente ese mismo set** (sus propios `kind:10050` incluidos), no
   a una lista fija. Si el receptor solo mira relays fijos, cualquier usuario que haya
   declarado su bandeja de DMs en otro cliente Nostr **no recibe el reto** aunque el
   emisor vea "enviado" (basta con que UN relay acepte la publicación). Síntoma:
   "mando el reto y no llega". Fix: **una sola función `resolveDmRelays(pubkey)` usada
   por ambos lados.** (Aparte, tené presente que algunos relays de DM exigen **NIP-42
   AUTH** para servir/aceptar `kind:1059`; si usás una lib que no autentica, medí las
   aceptaciones por-relay antes de dar el envío por bueno.)
9. **La extensión inyecta `window.nostr` de forma ASÍNCRONA — esperala al restaurar
   la sesión.** nos2x/Alby inyectan `window.nostr` un instante DESPUÉS de cargar la
   página. Si al reabrir la pestaña restaurás el signer NIP-07 con un
   `if (!window.nostr) return null` inmediato, te rendís antes de que exista y
   **cualquier feature gateada por el firmante (buzón de retos, presencia, marcador)
   no arranca** hasta un re-login MANUAL. Síntoma exacto: "los retos solo llegan si
   cierro sesión y vuelvo a entrar; tras recargar la pestaña dejan de llegar". Fix:
   **sondeá `window.nostr` unos segundos** (p.ej. cada 100 ms hasta ~3 s) antes de
   crear el signer NIP-07, o reintentá el arranque de esas features cuando la extensión
   aparezca. No afecta a clave local ni bunker NIP-46 (no dependen de `window.nostr`).
10. **NIP-17 (`kind:1059`) y NIP-04 (`kind:4`) son bandejas DISTINTAS: un chat que
    solo lee una no ve la otra.** El reto/invitación 2.0 viaja como gift-wrap NIP-17;
    un chat legacy que consulta solo `kind:4` (NIP-04) **jamás lo muestra**, aunque
    llegue bien a los relays. Síntoma: "mando el reto y el invitado no lo ve al abrir
    el chat de la tienda". No es de relays: es de protocolo. Fix (lado lector): que el
    chat consulte **también** `kind:1059 #p=<yo>`, desenvuelva las tres capas
    (gift-wrap → seal `kind:13` → rumor `kind:14`, verificando `rumor.pubkey ===
    seal.pubkey`) y fusione esos rumores con los `kind:4`. Dos gotchas al hacerlo: (a)
    el gift-wrap lleva `created_at` **aleatorizado al pasado** (NIP-59) → no lo filtres
    con `since: now()` en la suscripción en vivo o perdés mensajes nuevos; filtrá por la
    hora REAL del `rumor.created_at` tras desenvolver; (b) resolvé los relays con el
    mismo `resolveDmRelays` del gotcha #8 (tus `kind:10050`), no un set fijo.

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
- [ ] (opc.) §5·bis Luna Room Link: manejo `?lnRoom=` (+ cold-open a `/launch/<slug>`), creo la sala lazy y declaro la capacidad en el panel.
- [ ] (opc.) §6 Marcadores.
- [ ] (opc.) §7 Apuestas/escrow desde el backend.
- [ ] (opc., experimental) §7·bis Apuestas v2 por zaps (`/api/v2/bets`, opt-in `BETS_V2_ENABLED`).
- [ ] (opc.) §8 Webhook registrado y firma HMAC verificada.
- [ ] (opc., experimental) Capa 2.0 Nostr: marcador `kind:31337`, presencia NIP-38,
      reto/invitación NIP-17, zaps NIP-57, reseñas `kind:1`. Nunca para escrow/pago.
- [ ] API key solo en el servidor; nada de secretos en el cliente.

## Dónde seguir

- Referencia interactiva: `__LUNA_NEGRA_BASE__/developers`
- Contrato OpenAPI (machine-readable): `__LUNA_NEGRA_BASE__/openapi.json`
- Guía humana: `__LUNA_NEGRA_BASE__/dev`
- JWKS público: `__LUNA_NEGRA_BASE__/.well-known/jwks.json`
