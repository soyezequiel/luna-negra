---
name: integrar-ngp-v2
description: >-
  Integra juegos con Nostr Games Protocol (NGP) v2: login
  NIP-07/NIP-46, coordenada gameCoord, presencia NIP-38, marcador kind:31339,
  retos e invitaciones NIP-17, Room Link (?join) para invitar a jugar en salas
  hosteadas por el juego, salas NIP-29 de diseño, reseñas/logros kind:1,
  zaps NIP-57, marcador verificado por oráculo (kind:31338),
  apuestas custodiadas por NGE o por zaps bajo /api/v2/bets y
  patrones probados en Tetris para signers, relays, inbox NIP-17 y auto-firma de
  depósitos. Usar cuando el usuario pida integrar un juego con Luna Negra,
  Room Link / ?join (antes ?lnRoom) / invitar a jugar en una sala, eventos Nostr nativos,
  resiliencia/interoperabilidad Nostr, retos 1v1,
  presencia Nostr, leaderboard Nostr, integración NGP/NGE, zaps o escrow por
  zap. La interfaz REST 1.0 fue retirada; solo sobreviven los webhooks firmados
  y la validación de compra de juegos de pago del lado de Luna Negra.
---

# Integrar juegos con Nostr Games Protocol (NGP)

Nostr Games Protocol (NGP) usa eventos Nostr firmados por el jugador o el juego para la
capa social: presencia, marcadores, retos, reseñas, logros, zaps y apuestas.
Los kinds de apuestas (1339/1341/31340) y el wire NGE (24940–24942) están
congelados en v1; los `kind` marcados como diseño (31338, salas) pueden cambiar.

**La interfaz REST 1.0 fue retirada.** NGP (formato público) + NGE (canal de
escrow) son el camino para todo: identidad, social y apuestas custodiadas. Lo
único que queda fuera son los webhooks firmados (notificaciones
server-to-server con HMAC, sin evento Nostr equivalente) y la validación de la
compra de juegos de pago, que sigue haciéndola Luna Negra. Las apuestas —por
NGE o por zaps NIP-57— siguen siendo custodiales y server-to-server con Luna
Negra aunque la liquidación quede auditable en relays.

## Cuándo usarla

Usa esta skill si el usuario pide explícitamente alguno de estos objetivos:

- Login Nostr nativo con NIP-07 o NIP-46.
- Presencia "jugando X" publicada como NIP-38.
- Marcador firmado por el jugador con `kind:31339`.
- Retos o invitaciones 1v1 con NIP-17.
- Reseñas, comentarios o logros anclados al juego.
- Zaps NIP-57 al dev, al ganador o al juego.
- Apuestas custodiadas: canal NGE (recomendado) o zaps v2 con `/api/v2/bets`.
- Interoperabilidad NGP con clientes Nostr sin depender solo de Luna Negra.

Si el usuario pide "integrar mi juego con Luna Negra" sin nombrar NGP, también
es esta skill: es el único camino de integración vigente.

Mapa de la skill según lo que pidan:

| Pedido | Sección |
|---|---|
| "Integrá mi juego" / lo social mínimo | Camino rápido |
| Login Nostr | Identidad Nostr |
| Leaderboard | Marcador `kind:31339` |
| "Jugando ahora" | Presencia NIP-38 |
| Retos / invitar amigos | Retos e invitaciones NIP-17 |
| Apuestas con pozo | Apuestas custodiadas: canal NGE |
| Apuestas firmando en el browser | Apuestas v2 por zaps |
| Propinas sin custodia | Zaps NIP-57 |

## Camino rápido

La integración social mínima (identidad + marcador) son ~20 líneas. Todo lo
demás se apila sobre esto.

```sh
npm i github:soyezequiel/Nostr-Game-Protocol nostr-tools
```

```ts
import { SimplePool } from "nostr-tools";
import { buildScoreEvent } from "nostr-game-protocol/ngp";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

// 1. Coordenada real del juego (traela una vez y cacheala).
const { coords } = await fetch("__LUNA_NEGRA_BASE__/api/store/coords").then((r) => r.json());
const gameCoord = coords["<slug-del-juego>"];

// 2. Identidad: window.nostr (NIP-07) satisface NgpSigner tal cual.
if (!window.nostr) throw new Error("Instalá una extensión Nostr (Alby, nos2x…)");
const signer = window.nostr;

// 3. Publicar el mejor puntaje del jugador (kind:31339, firmado por él).
const evt = await buildScoreEvent(signer, {
  gameCoord,
  board: "clasico",
  score: 12500,
  client: "mi-juego",
});
await Promise.any(new SimplePool().publish(RELAYS, evt));
```

Con eso el juego ya aparece con marcador Nostr en Luna Negra (score-sync lo
proyecta al ranking) y en cualquier cliente compatible. Siguientes pasos
típicos, cada uno con su sección abajo: presencia NIP-38 ("jugando ahora"),
retos NIP-17, y apuestas custodiadas con NGE.

## Prerrequisitos

Necesitas:

- Un signer Nostr del jugador: `window.nostr` (NIP-07), bunker NIP-46 o clave
  local si el juego la administra.
- La pubkey hex del jugador.
- `gameCoord`, la coordenada del juego: `30023:<pubkeyDelFirmante>:<slug>`. El
  firmante del artículo puede ser la tienda o el propio proveedor
  (`articleSigner`), así que no asumas la pubkey de la tienda.
- Relays de escritura y lectura medidos; separa relays read-only de relays que
  aceptan publicaciones.

Puedes obtener `gameCoord` de `GET __LUNA_NEGRA_BASE__/api/store/coords`
(devuelve `{ pubkey, coords: { "<slug>": "<gameCoord>" } }` de los juegos
publicados), o consultando el `kind:30023` real en relays:

```ts
{ kinds: [30023], "#d": ["<slug>"] }
```

No inventes `gameCoord`. El `slug` no siempre coincide con el nombre visible.

## SDK: paquete `nostr-game-protocol`

El wire de NGP y NGE (el formato exacto de cada evento) vive en un paquete
canónico: **[`nostr-game-protocol`](https://github.com/soyezequiel/Nostr-Game-Protocol)**.
Es la misma pieza que usa la tienda; instalándolo evitás reimplementar los
templates y parsers a mano (y evitás que tu copia se desincronice del formato
que la tienda espera).

```sh
npm i github:soyezequiel/Nostr-Game-Protocol
npm i nostr-tools   # peer dependency
```

> **Es una dependencia git — dos gotchas que costaron horas:**
> - **Docker/CI necesita `git`.** `npm ci`/`npm install` clona el paquete con `git`;
>   las imágenes `node:*-slim` NO lo traen → el build rompe. Agregá `git` a la etapa
>   que corre `npm ci` (`apt-get install -y git`).
> - **`npm update` MIENTE con deps git** (dice "up to date" sin traer el commit nuevo).
>   Para actualizar al último SDK: `npm install github:soyezequiel/Nostr-Game-Protocol`
>   otra vez y **verificá que el hash de commit del lockfile cambió**; si no, tu build
>   shippea el SDK viejo desde caché.

Qué te da, por subpath:

| Import | Trae |
|---|---|
| `nostr-game-protocol/ngp` | `buildScoreTemplate` (marcador 31339), `buildPresenceTemplate` / `buildPresenceClearTemplate` (NIP-38), los helpers de reto NIP-17 (`buildChallengeGiftWraps`, `parseChallengeGiftWrap`), la interfaz `NgpSigner` y los parsers (`parseScoreEvent`, `parsePresenceEvent`, que aceptan también el legacy 31337). |
| `nostr-game-protocol/nge` | La clase `NGE` (cliente del escrow de apuestas), transporte inyectable y `auditSettlement`. Ver la sección de apuestas. |
| `nostr-game-protocol/ngp-core` / `/nge-core` | Solo el wire puro (kinds, templates sin firmar, parsers), sin ergonomía. `ngp-core` además trae los helpers del link de sala `?join`: `buildRoomLink` / `parseRoomLink` / `ROOM_ID_RE` (v0.2.0+). |

Los templates salen **sin firmar**: vos les pasás el contexto (coordenada,
puntaje, TTL) y los firmás con tu signer. El paquete no toca relays ni env: la
publicación es tuya. Los bloques de código de abajo muestran el evento crudo
para que entiendas el formato; en producción preferí los helpers del paquete.

## Capacidades

| Capacidad | Cómo se hace hoy | Estado |
|---|---|---|
| Identidad | NIP-07/NIP-46 (el jugador firma; no hay SSO de Luna) | disponible |
| Marcador | `kind:31339` (legacy 31337 solo lectura) | en producción |
| Presencia | NIP-38 `kind:30315` con `a=gameCoord` | en producción |
| Salas/estado | NIP-29 + jugadas | diseño |
| Invitación/reto | NIP-17 gift-wrap (DM cifrado con el link de la sala) | reto 1v1 en producción |
| Invitar a jugar (Room Link) | URL `?join=<id>`; tu juego crea/une la sala (ver sección Room Link) | en producción |
| Reseñas/logros | `kind:1` con `a=gameCoord` | en producción |
| Propinas/premios | zaps NIP-57 | en producción |
| Apuestas custodiadas | canal NGE (recomendado) o zaps NIP-57 bajo `/api/v2/bets` | en producción |
| Marcador verificado | `kind:31338` (atestación de oráculo, server-side) | disponible (requiere declarar el oráculo en el 30023) |
| Compra de juego de pago | la valida Luna Negra (no hay evento Nostr) | fuera de NGP |
| Webhooks firmados | HMAC server-to-server de Luna Negra | fuera de NGP |

## Patrón probado en Tetris

Organiza la integración en módulos pequeños:

- `nostrSigner`: signer activo singleton, restore desde storage, NIP-07/NIP-46/local.
- `nostrRelays`: `SimplePool` singleton y listas de relays por función.
- `nostrLogin`: deriva `pubkey`/`npub`, perfil best-effort y recién entonces persiste signer.
- `nostrPresence`: construir/publicar/limpiar NIP-38.
- `nostrLeaderboard`: construir/publicar `kind:31339`.
- `nostrChallenge` + `nostrChallengeInbox`: armar, publicar, parsear y deduplicar NIP-17.
- `lunaNegraNge`: puerto server-side del canal NGE (clase `NGE` del SDK); la UI
  solo ve `betId`, `bolt11` y estado — nunca la credencial.

Orden de bootstrap recomendado:

1. Restaurar signer guardado; para NIP-07, esperar hasta 3 s a que aparezca
   `window.nostr`.
2. Obtener pubkey, derivar `npub`, cargar perfil Nostr best-effort.
3. Activar presencia NIP-38 y el inbox NIP-17 solo cuando hay signer activo.
4. En logout, parar inbox y publicar presencia vacía con expiración inmediata.
5. En apuestas, mantener el resultado y la creación/resolución en backend; el
   browser solo firma el `kind:9734` de depósito y, opcionalmente, el comentario.

Relays:

```ts
const PROFILE_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol", "wss://relay.primal.net"];
const DM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social"];
const PUBLIC_WRITE_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
```

No publiques a `relay.nostr.band`; úsalo para lectura/indexación, no escritura.

## Identidad Nostr

Para NIP-07:

```ts
async function getNostrIdentity() {
  if (!window.nostr) throw new Error("No hay signer NIP-07");
  const pubkey = await window.nostr.getPublicKey();
  return { pubkey };
}
```

Al restaurar sesión, espera la inyección de `window.nostr`; algunas extensiones
la agregan después de cargar la página.

```ts
async function waitForNostr(timeoutMs = 3000) {
  const started = Date.now();
  while (!window.nostr && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.nostr ?? null;
}
```

Con bunker NIP-46, evita firmar en cada heartbeat: cada firma puede disparar un
prompt al usuario.

Persiste el método de signer, no solo la identidad. Para clave local puedes guardar
`nsec`; para NIP-46 guarda client secret + bunker; para NIP-07 guarda solo
`{ method:"nip07" }` y restaura cuando la extensión exista. Envuelve el signer en
un único punto para disparar un aviso antes de cada `signEvent`; así presencia,
score, retos y depósito muestran qué se firma.

### Sesión que persiste (lecciones que costaron bugs reales)

Si tu juego tiene un **servidor autoritativo** que necesita confiar en el `pubkey`
(salas, rankings con dinero, apuestas), el server pide **firmar un reto** (kind:22242)
en cada conexión. Tres cosas que aprendimos a los golpes:

- **Emití un token de sesión** tras el primer login firmado (HMAC/JWT del server) y
  reconectá/recargá con el token en vez de re-firmar. Sin esto, la sesión "se cierra"
  al recargar o te pide firmar en cada carga. Estabilizá el secreto (env) para que el
  token sobreviva a los redeploys.
- **No bloquees la sesión en el firmador.** Si hay token, autenticá DE INMEDIATO y
  restaurá el signer en segundo plano. Si esperás `getPublicKey()` antes de autenticar
  y la extensión está lenta o bloqueada, la app se cuelga para siempre en "Conectando…".
  Poné además un timeout/escape en esa pantalla.
- **Al restaurar, esperá `window.nostr`** (`waitForNostr` arriba): las extensiones lo
  inyectan async; si te rendís al instante, la sesión "se cierra" en cada reload.

**NIP-46 (Amber/Primal/nsec.app) cifran con NIP-04, no NIP-44.** El `BunkerSigner` de
nostr-tools solo habla NIP-44 y se traba ("aprueba y no pasa nada"). Usá detección dual
NIP-44/NIP-04.

Todo el login (NIP-07 + NIP-46 por QR/bunker + clave local + token de sesión, con el
arreglo de cada gotcha) está encapsulado en la skill **`nostr-tool`** (código
reutilizable `nostr-login-tool` + los 10 gotchas). Si vas a poner login Nostr, usala.

## Marcador `kind:31339`

El jugador firma su mejor puntaje y lo publica a relays. Luna Negra lo proyecta
a su ranking (score-sync), pero el evento también lo puede leer cualquier
cliente Nostr.

> El kind se renumeró de 31337 a **31339** en julio de 2026 (31337 es "Audio
> Track" de facto en otros clientes). Publicá siempre 31339; el 31337 queda
> solo como lectura legacy durante la transición.

```ts
import { SimplePool } from "nostr-tools";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const board = "clasico";

const evt = await window.nostr.signEvent({
  kind: 31339,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", gameCoord],
    ["d", `${gameCoord}:${board}`],
    ["board", board],
    ["score", String(puntaje)],
    ["client", "tu-juego"],
  ],
  content: "",
});

await Promise.any(new SimplePool().publish(RELAYS, evt));
```

Reglas:

- `a` debe ser el `gameCoord` real.
- `kind:31339` es addressable.
- `d` debe ser `<gameCoord>:<board>`, para un récord por jugador y tablero.
- `board` debe matchear `^[a-z0-9][a-z0-9_-]{0,63}$`.
- `score` debe ser entero, no negativo y preferentemente clampeado a `1_000_000_000`.
- Usa el mismo nombre de `board` y las mismas unidades que el ranking histórico
  del juego si existía, para que se fusionen.
- El puntaje firmado por cliente es falsificable; no lo uses para repartir dinero.
- Construye una función `buildScoreEvent()` que solo firma y otra `publishScore()`
  best-effort. Testea `kind`, `pubkey`, `a`, `d`, `board`, `score` y `verifyEvent`.
- Atajo: `buildScoreTemplate({ gameCoord, board, score })` de
  `nostr-game-protocol/ngp` arma este template (con las validaciones de `board` y
  el clamp ya hechas). Solo lo firmás y publicás.

Para leer sin Luna Negra:

```ts
// NGP_SCORE_READ_KINDS del SDK = [31339, 31337] (nuevo + legacy en transición)
{ kinds: [31339, 31337], "#a": [gameCoord], "#board": [board] }
```

Agrupa por `pubkey` y quédate con el mejor `score` (ante empate, gana el 31339).

## Presencia NIP-38

El propio jugador firma el estado. No hace falta game server.

```jsonc
{
  "kind": 30315,
  "tags": [
    ["d", "general"],
    ["a", "30023:<firmante>:<slug>"],
    ["expiration", "<unix + 60-240s>"]
  ],
  "content": "Jugando Pac-Toshi"
}
```

El `content` va sin prefijo ni emoji si Luna Negra ya lo decora. Re-firma solo si
cambió el estado o pasaron unos 2 minutos. El `expiration` debe ser mayor que tu
intervalo de heartbeat para evitar titileo.

Patrón Tetris:

- TTL de presencia de unos 240 s para no disparar firmas frecuentes con NIP-46.
- `d="general"` para que el estado sea reemplazable.
- `content` `"Jugando <juego>"` para `in-game` y otro texto corto para `online`.
- Publicación best-effort con `Promise.any(pool.publish(PUBLIC_WRITE_RELAYS, evt))`.
- Limpieza en logout: firmar `kind:30315` con `content:""` y
  `["expiration", "<now+1>"]` para que desaparezca sin esperar TTL.

## Retos e invitaciones NIP-17

En NGP la invitación es un reto cifrado E2E. El server no puede leerlo. El rumor
interno es `kind:14` y viaja como gift-wrap `kind:1059`.

```jsonc
{
  "kind": 14,
  "pubkey": "<retador>",
  "tags": [
    ["p", "<invitado>"],
    ["game", "30023:<firmante>:<slug>"],
    ["url", "https://tu-juego.com/?room=..."],
    ["expiration", "<unix>"]
  ],
  "content": "Te reto a una partida"
}
```

Para 1v1 puro omite `room`. Si usas sala NIP-29, agrega:

```jsonc
["room", "<groupId>", "wss://relay..."]
```

Requisitos:

- Signer con NIP-44 para cifrado moderno.
- Publicar el gift-wrap en la bandeja NIP-17 del destinatario.
- Resolver relays de DM con una sola función compartida por emisor y receptor.
- Al recibir, desenvolver `kind:1059` -> seal `kind:13` -> rumor `kind:14`.
- Verificar `rumor.pubkey === seal.pubkey` para evitar suplantación.

La causa más común de "reto enviado pero no llega" es publicar en un set de relays
y escuchar en otro. Usa fallback de DM unido a los `kind:10050` del destinatario.

Patrón Tetris para no depender de la clave privada cruda:

1. Crear un rumor `kind:14` sin firma, con tags `p`, `game`, `url`,
   `expiration` y, si aplica, `room`. Calcular `id` con `getEventHash`.
2. Cifrar el rumor con NIP-44 hacia el destinatario y firmar un seal `kind:13`
   con el signer del emisor.
3. Cifrar el seal con una clave efímera hacia el destinatario y firmar el
   gift-wrap `kind:1059` con esa clave efímera.
4. Crear también una auto-copia del gift-wrap dirigida al emisor para que el reto
   aparezca en su propio historial.
5. Usar timestamps aleatorizados hasta 2 días hacia atrás en seal/gift-wrap
   (NIP-59). Por eso el inbox debe suscribirse con lookback de ~3 días, no
   `since: now()`.
6. Al parsear, rechazar si expiró, si `game` no coincide, si la URL no es del
   mismo origin, o si `rumor.pubkey !== seal.pubkey`.
7. Deduplicar por `giftWrap.id` y por `rumor.id`, y persistir ids vistos acotados
   en storage para no repetir toasts al recargar.

## Salas NIP-29

Esto es diseño, no contrato estable. Para juegos por turnos determinísticos:

- La sala es un grupo NIP-29 en un relay group-aware.
- Cada jugada es un evento firmado, por ejemplo `kind:9421` propuesto.
- Tags esperados: `h=<groupId>`, `a=<gameCoord>`, `seq`, `prev`.
- El estado se reconstruye plegando jugadas.

No uses este diseño para tiempo real exigente, información oculta, azar no
verificable o dinero. Usa un árbitro en tu propio backend (y NGE si hay dinero
en juego).

## Room Link de Luna (`?join`)

Estándar de Luna para **invitar a jugar en una sala hosteada por tu juego**, sin que
quien invita abra el juego primero y sin que la sala pre-exista. Luna arma el enlace
solo (conoce tu `gameUrl`) y lo comparte:

```
https://<tu gameUrl>/?join=<roomId>      (opcional: &lnOrigin=<origen de Luna>, informativo)
```

- `join`: id de sala opaco, `^[A-Za-z0-9_-]{1,64}$`. **No pre-existe**: tu juego lo
  crea *lazy* al primer acceso.
- **Armá y parseá el link con los helpers del SDK**, no a mano:
  `buildRoomLink(gameUrl, roomId)` / `parseRoomLink(url|search)` / `ROOM_ID_RE`, en
  `nostr-game-protocol/ngp-core` (v0.2.0+). Así usás EXACTAMENTE el mismo formato que
  la tienda y que el `url` del reto NIP-17 — un solo camino de entrada a sala.
- Es una **URL pelada**: NO lleva token de identidad. Luna **nunca** mintea `lnToken`
  para este flujo. La identidad la resuelve **tu juego** por Nostr (NIP-07/46). Es
  **público**: cualquiera con el link entra.
- El **contrato de URL** no es un evento Nostr (es URL + el transporte propio de tu
  juego: WebSocket, etc.), aunque el SDK trae los helpers del link. Distinto del tag
  `room` de los retos NIP-17 (grupo NIP-29) y del `room`+`inviteToken` de salas de Luna.

### Contrato del lado del juego (esto es lo que implementás)

1. **Leé `?join`** al cargar (validá el formato). Guardalo hasta que el jugador
   esté autenticado; recién ahí limpialo de la URL (junto con `?lnOrigin`).
2. **Autenticá** al jugador por Nostr (tu login habitual).
3. **Entrá-o-creá** la sala con el id que vino en `?join`, en tu backend: si existe,
   unite; si no, creala con **ESE** id (el primero que abre es el host). NO uses tu
   generador de ids acá — la sala debe tener el id del `?join`, para que los dos que
   abren el mismo link caigan en la MISMA sala. (El mismo `?join` sirve para tu invite
   propio y para el Room Link de la tienda: un solo camino de entrada.)

### Implementación de referencia (juego Ajedrez)

- **web**: `pendingJoin()` lee y valida `?join`; en el handler `authed`, si hay
  `join` llama `net.enterRoom(join)` (unir-o-crear); `cleanUrl` borra `join`/`lnOrigin`.
- **server**: mensaje `enter_room {roomId}` → `RoomManager.enterByExternalId(roomId,
  jugador)`: si la sala existe la une, si no la crea con ese id (1º host/blancas, 2º
  negras). Valida `^[A-Za-z0-9_-]{1,64}$`.

### Gotchas (para que funcione a la primera)

- **Unir-o-crear, no solo unir.** Si tu "join" tira error cuando la sala no existe,
  el Room Link nunca arranca (la sala se crea lazy en el primer acceso).
- **Leé `join` ANTES de limpiar la URL, y entrá DESPUÉS de autenticar.** Si limpiás
  la URL antes del login, perdés el `join`.
- **Mismo id para ambos jugadores.** La sala se crea con el `join` de Luna, no con
  un id tuyo — si no, el segundo jugador entra a otra sala y nunca se encuentran.
- **Identidad por Nostr, no por Luna.** No esperes un `lnToken`; Luna no lo manda. Si
  tu juego acepta invitados, podés dejarlos entrar; si querés respetar el contrato al
  pie, forzá login Nostr para este ramal.

Doc canónico del contrato: `docs/luna-room-link.md` (en el repo de Luna Negra).

## Reseñas, comentarios y logros

Publica un `kind:1` con tag `a=gameCoord`.

```jsonc
{
  "kind": 1,
  "tags": [["a", "30023:<firmante>:<slug>"]],
  "content": "Gran juego, nuevo logro desbloqueado"
}
```

Luna Negra ya puede leerlos y mostrarlos en la ficha del juego. No necesitas
construir UI de lectura salvo que el juego quiera mostrarlos dentro.

## Zaps NIP-57

Usa zaps para propinas o premios sin escrow: al dev, al ganador o a un evento del
juego. Los recibos `kind:9735` verificados alimentan rankings de zappers.

No mezcles zaps libres con apuestas custodiadas: si hay depósito, pozo y payout
usa el flujo de apuestas v2 por zaps de esta skill.

Gotchas de zaps (costaron un rato):

- **Timeout del perfil.** Para armar el zap necesitás el `lud16` del receptor de su
  `kind:0`. Ese perfil puede vivir sobre todo en un relay lento (p. ej. primal) y
  tardar ~3 s en llegar; con un timeout corto (2,5 s) parece "sin lud16" cuando sí lo
  tiene, y reintentar no alcanza. Dale una ventana holgada (~6 s) y varios relays a esa
  búsqueda de perfil. (Bug real: el fetch cortaba a 2524 ms; el kind:0 llegaba a 3008 ms.)
- **El receptor necesita `lud16` Y aceptar zaps Nostr.** Su LNURL-pay tiene que
  devolver `allowsNostr:true` + `nostrPubkey`; si no, no hay zap NIP-57 (solo un pago
  LNURL normal, sin recibo `kind:9735`). Chequealo antes de prometer "propina".
- **Anclá el zap a tu juego.** `makeZapRequest` no agrega `a=gameCoord` por defecto:
  si querés que Luna atribuya la propina a TU juego (y no la vea como un zap genérico),
  sumá `["a", gameCoord]` al `kind:9734`; se copia al recibo `kind:9735`.
- El éxito del callback LNURL es que devuelva `pr` (invoice), no el HTTP 200.
- El recibo `kind:9735` NO se puede falsear desde el cliente: lo emite el LNURL del
  receptor recién cuando alguien PAGA el invoice. Para probar la integración, pagá un
  monto mínimo real (p. ej. 4 sats) — a vos mismo si tu perfil tiene `lud16`.

## Apuestas custodiadas: canal NGE (recomendado)

NGE (Nostr Game Escrow) es un RPC cifrado estilo NWC: el juego pega **una sola
URI de conexión** y opera el escrow desde su servidor con la clase `NGE` de
`nostr-game-protocol/nge`. No hace falta firmar nada en el browser: los
jugadores solo pagan un invoice Lightning.

**1. Obtener la credencial** (una vez, el dueño del juego): desde el panel
`/provider` → Integración, o por API:

```ts
POST __LUNA_NEGRA_BASE__/api/provider/nge/credential
Authorization: Bearer ln_sk_…        // API key del proveedor (o sesión del panel)
{ "gameId": "<id>" }
// → { uri: "nostr+nge://…", relays, escrowPubkey, servicePubkey, envVar: "NGE_CONNECTION" }
```

Guardá `uri` como secreto de **servidor** en `NGE_CONNECTION`. Nunca al browser:
quien tiene la URI opera el escrow del juego. `{ "rotate": true }` revoca la
anterior y emite una nueva.

**2. Operar el escrow** (server-side):

```ts
import { NGE, auditSettlement } from "nostr-game-protocol/nge";

const nge = NGE.fromEnv(); // lee NGE_CONNECTION

const info = await nge.getInfo(); // capacidades, límites, comisión

// Crear la apuesta: un bolt11 POR ASIENTO para mostrar como QR.
const bet = await nge.createBet({
  seats: [
    { seatId: "p1", pubkey: "<hex-o-npub>" },   // pubkey opcional: habilita payout social
    { seatId: "p2", payoutAddress: "ana@getalby.com" }, // o lud16 directo
  ],
  stakeSats: 210,               // por asiento; pozo = stake × asientos
  condition: "Gana la partida", // texto humano
  clientRef: partidaId,         // idempotencia: reintentar devuelve el MISMO betId
});
// bet.deposits → [{ seatId, bolt11, amountSats }] listos para QR

// Seguir el estado: watchBet (push 24942 + respaldo) o pollBet en serverless.
const stop = nge.watchBet(bet.betId, (b) => {
  if (b.status === "funded") empezarPartida();
});

// Al terminar, el juego ES el oráculo: ganadores por seatId.
// [] = empate/anulación → reembolso. Puede devolver settleAt (ventana de
// disputa): el resultado queda fijo pero el payout se ejecuta a esa hora.
await nge.reportResult(bet.betId, ["p1"]);

// Pre-fondeo se puede abortar (reembolsa lo ya pagado):
await nge.cancelBet(bet.betId);
```

La coordinación RPC es privada, pero la liquidación queda auditable en relays
como eventos NGP (contrato 1339, resultado 1341, sombra de estado 31340) salvo
`visibility: "unlisted"`. `auditSettlement(bet, info)` verifica del lado del
juego que el reparto publicado cuadre con lo pactado.

Gotchas NGE:

- `NGE_CONNECTION` es un secreto de servidor; si se filtró, rotala.
- Usá siempre `clientRef` al crear: un timeout de RPC reintentado sin él puede
  duplicar la apuesta.
- `reportResult` es por **seatId**, no por pubkey.
- Estados: `pending_deposits → funded → resolving → settled` (o
  `cancelled`/`expired`/`refunded`). `watchBet`/`pollBet` se cortan solos al
  llegar a un estado terminal.
- `getInfo()` dice qué soporta el escrow (métodos, `visibilityOptions`,
  límites); ante `RATE_LIMITED`, espaciá los RPC.

### Gating y UX del lado del cliente (dónde aparece "apostar")

El escrow es server-side, pero la UI de proponer apuesta vive en el cliente y tiene
condiciones que, si no las mostrás bien, te dejan con el clásico **"no aparece ningún
flujo para apostar"** (horas perdidas mirando el server, que estaba bien).

- **Anunciá `betsEnabled` al cliente.** El server sabe si hay escrow
  (`Boolean(NGE_CONNECTION)`); mandáselo al cliente (p. ej. un mensaje `caps { bets }`
  al autenticar) para que renderice o no la UI. Sin esto el cliente no puede saber si
  las apuestas están prendidas.
- **La UI de "proponer" solo tiene sentido con las TRES:** (a) escrow habilitado,
  (b) **ambos jugadores con `pubkey` Nostr** (ninguno invitado), (c) sos el
  **anfitrión** (el que propone). Si falta alguna, no hay input de apuesta.
- **NO la ocultes en silencio: mostrá el MOTIVO.** Si devolvés `""` cuando no se
  cumple una condición, el usuario ve "no aparece nada" y no sabe por qué. Renderizá un
  cartelito por cada caso: *"esperando rival"*, *"ambos deben entrar con Nostr para
  apostar"*, *"solo el anfitrión propone"*. (Gotcha real y caro: el rival entró como
  **invitado** por el link de sala → sin `pubkey` → la apuesta se apagaba sin explicar
  nada, y parecía un bug del server.)
- **Propagá el `pubkey` hasta la vista de sala que ve el cliente.** El chequeo
  "ambos son Nostr" corre sobre el roster que llega al browser: si tu `RoomView` no
  incluye el `pubkey` de cada jugador, el chequeo da falso negativo aunque los dos
  hayan entrado con Nostr. (En el server: pasá `pubkey` de la identidad al alta del
  jugador Y al serializar la sala.)
- **Flujo operativo:** solo el host propone `stakeSats` → el escrow emite **un invoice
  por asiento/color** → cada jugador paga el suyo → al fondear los dos, arranca la
  partida → ganador se lleva el pozo (menos fee), empate → reembolso. Un jugador
  invitado NO puede apostar (no tiene pubkey para el payout).

## Apuestas v2 por zaps (alternativa browser-first)

Elegí este flujo solo si querés que el jugador firme su depósito como zap
NIP-57 desde el browser; si tu juego tiene backend, NGE es más simple. Es el
mismo escrow custodial de Luna Negra, con el riel público: depósitos, premio,
corte de la casa y corte del dev quedan auditables como zaps en relays. Puede
estar apagado por deploy (`BETS_V2_ENABLED`).

Creación/resolución server-to-server bajo `/api/v2/bets`:

```ts
POST /api/v2/bets
GET  /api/v2/bets/{id}
POST /api/v2/bets/{id}/result
POST /api/v2/bets/{id}/cancel
```

La diferencia está en el depósito: lo paga el jugador firmando un zap request
NIP-57.

- Sin construir UI: manda al jugador a
  `__LUNA_NEGRA_BASE__/apuestas/{betId}` para firmar el zap, pagar y ver estado.
- UI propia (patrón Tetris): `GET /api/v2/bets/{id}` trae, por participante, un
  `depositZapRequest` (`kind:9734` sin firmar) + su `depositCallback` LNURL-pay. El
  browser firma el 9734 y tu backend hace
  `GET depositCallback?amount=<stakeSats*1000>&nostr=<9734-firmado>`; el `pr` que
  devuelve es el invoice a pagar.
- Después pollea `GET /api/v2/bets/{id}` hasta que el depósito del participante
  quede pagado.

El resultado sigue viniendo del game server (no del marcador cliente), en dos
modos según cómo custodies la clave de oráculo:

```ts
// Oráculo GESTIONADO (default): Luna firma el 1341 por vos.
POST /api/v2/bets/{id}/result { "winners": ["npub1..."] }   // Authorization: Bearer ln_sk_…
```

**Keyless (clave de oráculo propia / BYO).** Si querés reportar SIN API key: declará
tu clave una vez (`GET /api/provider/oracle/self` da un `challenge`; firmalo con tu
clave de oráculo y postealo a `POST /api/provider/oracle/self { proof }`). Desde ahí
Luna no firma por vos: firmás tu propio `kind:1341` (`e`=contrato, `p`=ganadores,
`status`, `t`=`ngp-bet`) y lo **publicás en relays** — lo levanta el sync — o lo
mandás a `POST /api/v2/bets/{id}/result { "event": <1341-firmado> }` (la firma es la
auth, sin API key). `GET /api/v2/bets/ngp-config` trae `oracleSelfSigned` para saber
en qué modo estás. En modo BYO, `POST /result { winners }` responde
`SELF_SIGNED_ORACLE`.

Si el jugador también firma un comentario de participación `kind:1111` (comentario
NIP-22 sobre el evento del contrato), el premio puede zapearse a ese comentario
para que quede como zap recibido en su perfil. Se usa `kind:1111` y no `kind:1` a
propósito: los clientes no lo listan en las pestañas "Notas"/"Respuestas" del
perfil, así el perfil del apostador no se llena de respuestas redundantes. El juego
solo firma el template que devuelve Luna tal cual (no fija el kind); el depósito
funciona igual sin ese comentario.

Patrón Tetris para UI propia:

- Validar la forma mínima de `depositZapRequest`: `kind`, `created_at`, `content`
  y `tags: string[][]`. Si falta, caer a `payUrl`/`/apuestas/{betId}`.
- Antes de firmar, comprobar que `signer.getPublicKey()` coincide con la pubkey de
  la sesión Nostr del participante. Luna rechazará un 9734 firmado por otra clave.
- No re-firmar si el participante ya tiene `bolt11`; ese invoice ya compromete el
  zap request vía description hash.
- Firmar `participationComment` con la misma identidad, pero tratarlo best-effort:
  si falla, el depósito sigue y el premio cae al contrato.
- Enviar `signedZapRequest` y `signedComment` al backend propio; el backend reenvía
  el 9734 al `depositCallback` LNURL-pay con `?amount=<stakeMsat>&nostr=<json>`.
- El callback LNURL puede devolver `200` con error LNURL; el éxito real es que
  exista `pr`.
- Persistir el `bolt11` localmente al recibirlo para que el QR sobreviva al polling.
- Durante polls/refrescos, conservar `bolt11` o `depositZapRequest` +
  `depositCallback` del estado previo si el depósito sigue `pending`; evita que la
  UI parpadee al fallback.
- Auto-firma opcional: si llega `depositZapRequest` + `depositCallback`, hay signer
  activo/restaurable y el depósito está pending, dispara la firma una sola vez por
  `betId` con un guard anti-concurrencia. Deja botón manual como fallback.
- Si Luna devuelve `BETS_V2_DISABLED`, mostrar un error explícito; si devuelve
  `ANCHOR_PUBLISH_FAILED`, sugerir reintentar.

## Marcador verificado `kind:31338` (atestación de oráculo)

Dos tiers de marcador: **abierto** (`kind:31339`, lo firma el jugador, social,
falsificable) y **verificado** (`kind:31338`, lo firma un **ORÁCULO**, apto para
stakes). El verificado lo firma tu **servidor** con una clave de oráculo dedicada,
certificando un resultado que tu server presenció ("en la sala X ganó el jugador P").

**Implementación real (probada en Ajedrez).** La clave del oráculo es un SECRETO de
servidor (`NGP_ATTESTATION_ORACLE_NSEC`), nunca va al browser: el jugador no puede
firmar su propio marcador verificado.

```ts
// SERVER. NgpSigner del oráculo desde el nsec (nostr-tools ya es dep del server).
import { buildAttestationEvent } from "nostr-game-protocol/ngp";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { decode } from "nostr-tools/nip19";

const sk = decode(process.env.NGP_ATTESTATION_ORACLE_NSEC!).data as Uint8Array;
const oracleSigner = {
  getPublicKey: async () => getPublicKey(sk),
  signEvent: async (t) => finalizeEvent(t, sk),
};

const attestation = await buildAttestationEvent(oracleSigner, {
  gameCoord,
  ref: partidaId,        // id único de lo atestado → registro PERMANENTE (d=<gameCoord>:<ref>)
  playerPubkey: ganadorHex,
  status: "verified",    // "rejected"/playerPubkey vacío = anulación
  score: 1500,           // opcional; scoreEventId opcional (e-tag al 31339 atestado)
});
```

**Relay I/O:** el server firma; para no publicar desde el server, mandá el evento
firmado por tu transporte (WS) al cliente y que **el cliente lo publique** con su pool
(reusa el I/O de relays del browser). O publicá server-side con `SimplePool`.

**Gotcha que te va a morder — la DELEGACIÓN de oráculo.** Luna (y cualquier
verificador) solo cuenta el 31338 como *verificado autorizado* si la pubkey que lo
firmó está **declarada en el listing `kind:30023` del juego** como
`["oracle", <pubkey>]`. Sin esa delegación, el evento se ve en relays pero NO se
confía — por eso "marcador verificado" figura como *diseño* en el panel de la tienda
hasta que la declarás. La declara el **dueño del juego** en su 30023 (paso manual en
la tienda), no el código.

El SDK cierra el círculo:

- `oraclePubkeyFromListing(listing)` → saca la pubkey de oráculo declarada en el 30023
  (acepta `["oracle", pk]` o un `p` con token `oracle`); `null` = el juego no tiene tier
  verificado.
- `isAuthorizedAttestation(parsed, declaredOraclePubkey)` → valida que la firmó ESE
  oráculo. Verificá la firma criptográfica aparte con `verifyEvent(ev)`.
- `parseAttestationEvent(ev)` → desarma el 31338 (oraclePubkey, ref, player, status,
  score, scoreEventId). No verifica firma ni autorización: eso es del caller.

Reglas: el oráculo certifica SOLO lo que tu server realmente vio. La `ref` única por
partida hace el registro permanente (re-firmar el mismo `ref` lo corrige). El tier
verificado es el que conecta con stakes (NGE); el abierto 31339 nunca sirve para dinero.

## Verificar que Luna detecta (modo de prueba)

Luna marca cada integración "en uso" cuando **observa su evento en relays** (o en su
DB, para NGE). Para no tener que jugar partidas reales cada vez, armá un **panel de
diagnóstico detrás de un flag de URL** (`?ngptest=1`) que dispare cada integración con
un botón y reporte el resultado inline (event id + relays que aceptaron). Aislalo en un
módulo propio (un import + un `if (flag) montar()`) para poder **sacarlo después** sin
tocar el flujo normal.

Qué se puede disparar y desde dónde:

- **Client-side, con el signer del jugador** (publican desde el browser; Luna los ve
  por el tag `a=gameCoord`, sirve cualquier clave): presencia 30315, marcador 31339,
  reseña `kind:1`. Estos son los que flipean rápido a "en uso".
- **Server-side**: marcador verificado 31338 (lo firma el oráculo; el server te
  devuelve el evento y el cliente lo publica) y apuestas NGE (necesita `NGE_CONNECTION`
  + 2 jugadores Nostr + un asiento por color; no se fuerza en solitario).
- **Pago real**: el zap NIP-57 no se puede falsear — el recibo `kind:9735` lo emite el
  LNURL del receptor recién cuando alguien paga el invoice.

Usá el signer **real de la sesión Nostr** (no una clave nueva) cuando exista; si tu app
restaura el login async (token-first), esperá a que termine de restaurar antes de
firmar, o el panel arranca "sin firmante".

## Gotchas

1. `gameCoord` real no es placeholder. Si el `a` tag no coincide, Luna filtra por
   coord y no encuentra eventos.
2. No publiques a relays de solo lectura. Mantén relays de escritura separados.
3. Cada presencia NIP-38 es una firma. Throttlea con NIP-46.
4. No dupliques emoji/prefijo en `content` de presencia.
5. Para contactos y perfiles a escala, usa modelo outbox: lee `kind:3` y
   `kind:10002` desde relays de escritura del usuario, y trae `kind:0` por lotes.
6. La tienda debe aceptar eventos por `a=gameCoord`; no exigir tags privadas de
   Luna Negra.
7. `board` y unidades del `kind:31339` deben coincidir con el ranking histórico
   del juego si se fusionan.
8. NIP-17 requiere publicar y escuchar en el mismo set de relays, incluidos
   `kind:10050`. Algunos relays exigen NIP-42 AUTH.
9. `window.nostr` puede aparecer de forma asincrónica. Sondea antes de rendirte.
10. NIP-17 (`kind:1059`) y NIP-04 (`kind:4`) son bandejas distintas. Un chat que
    solo lee NIP-04 no ve retos NIP-17.
11. En apuestas v2, no borres handles de depósito por un poll incompleto. Conserva
    `bolt11` o `depositZapRequest` + `depositCallback` mientras el depósito siga
    pendiente.
12. En serverless, si el entrypoint de la función importa lógica transitiva, puede
    quedar cacheado. Expón una ruta de versión/rev del handler si estás desplegando
    en una plataforma con build cache agresivo.
13. **Room Link / entrada a sala: unir-o-CREAR, no solo unir.** El link `?join=<id>`
    apunta a una sala que NO pre-existe: el juego la crea lazy al primer acceso. Si tu
    "join" tira error cuando la sala no existe, el Room Link nunca arranca. Usá el
    mismo `?join` para tu invite propio y para el de la tienda (un solo camino). Armá/
    parseá con `buildRoomLink`/`parseRoomLink` del SDK.
14. **Sesión Nostr con servidor autoritativo: token, no re-firmar.** Emití un token de
    sesión tras el primer login firmado y reconectá con él; NO bloquees el arranque
    esperando al firmador (token-first) o te colgás en "Conectando…"; y esperá
    `window.nostr` al restaurar. Todo esto (más NIP-46 dual NIP-44/NIP-04) en la skill
    `nostr-tool`.
15. **SPA: no metas el build-id dentro del bundle JS.** Cambia el hash del bundle en
    cada deploy y un `index.html` viejo cacheado apunta a un bundle borrado → 404 → app
    rota / "no veo los cambios". Poné el build-id en el `index.html` (inyectado) y
    servilo `Cache-Control: no-cache`; los assets hasheados con caché larga.
16. **Secretos de escrow/oráculo: runtime, no imagen.** `NGE_CONNECTION` y
    `NGP_ATTESTATION_ORACLE_NSEC` son secretos de SERVIDOR: inyectalos en runtime
    (docker `env_file`/`-e`), nunca `COPY` al build ni en el repo. En docker-compose,
    `environment:` **pisa** `env_file` (útil: PORT/paths van en `environment`, los
    secretos en el `.env` de runtime). Al mergear el archivo de env del deploy,
    **preservá los secretos que ya estaban allá** (p. ej. el HMAC del token de sesión):
    no lo sobreescribas entero o invalidás las sesiones / apagás features.
17. **Mensaje WS nuevo = redeploy del server.** Si agregás un mensaje cliente→server
    (p. ej. pedir la atestación al oráculo) pero el server desplegado no tiene el
    handler, lo **ignora en silencio** y el cliente queda en timeout (parece "el server
    no respondió"). Deployá el código del server junto con el del cliente y verificá
    ADENTRO del contenedor que el handler está (`grep` el símbolo, chequeá el env con
    `printenv`) — un `COPY … CACHED` de Docker no siempre prueba lo que creés.
18. **No pises el handler de "error" del cliente WS.** Si tu cliente guarda un handler
    por tipo de mensaje, registrar un segundo `on("error")` desde un módulo aparte
    (panel de prueba, feature nueva) **pisa** el de la app. Respondé por un **canal
    dedicado** (p. ej. `test_attestation { event|null, error? }`) en vez del canal
    genérico "error": así mostrás el motivo real del fallo y no rompés el manejo de
    errores existente.
19. **Zaps: ventana holgada para el `lud16`.** El perfil (`kind:0`) del receptor puede
    tardar ~3 s (relay lento); un timeout de 2,5 s da "sin dirección Lightning" falso.
    Dale ~6 s y varios relays, y exigí `allowsNostr` en su LNURL-pay (ver sección Zaps).
20. **La UI de apuesta no aparece: es gating del cliente, no el server.** "No aparece
    ningún flujo para apostar" casi nunca es el escrow: es que falta una de las tres
    condiciones (escrow habilitado, ambos jugadores con `pubkey` Nostr, sos el host).
    La causa top: el **rival entró como invitado** por el link → sin pubkey. Mostrá el
    MOTIVO en vez de ocultar la UI, y asegurate de que el `pubkey` llegue al roster que
    ve el cliente (ver "Gating y UX del lado del cliente" en la sección NGE).

## Checklist

- [ ] Elegir signer: NIP-07, NIP-46 o clave local.
- [ ] Obtener `pubkey` del jugador.
- [ ] Obtener `gameCoord` real.
- [ ] Separar relays de escritura y lectura.
- [ ] Publicar y leer un evento round-trip con el mismo filtro `#a`.
- [ ] Throttlear presencia NIP-38.
- [ ] Mantener `board` consistente con el ranking histórico si aplica.
- [ ] Testear `kind:30315`, `kind:31339` y NIP-17 con `verifyEvent`/round-trip local.
- [ ] Para NIP-17, usar la misma `resolveDmRelays(pubkey)` en envío y recepción.
- [ ] Rechazar retos vencidos, de otro `gameCoord`, de otro origin o con
      `rumor.pubkey !== seal.pubkey`.
- [ ] Para apuestas custodiadas, pedir la credencial NGE, guardarla como secreto
      de servidor y crear siempre con `clientRef`.
- [ ] Mantener el resultado en el game server (nunca derivarlo del marcador
      cliente); reportar ganadores por `seatId`.
- [ ] Apuestas — gating del cliente: anunciar `betsEnabled` al cliente, mostrar la UI
      de proponer solo con escrow+ambos-Nostr+host, y **decir el motivo** cuando no
      (no ocultar); propagar el `pubkey` al roster que ve el browser.
- [ ] Si se usa el flujo por zaps: verificar signer contra sesión, no re-firmar
      si ya hay `bolt11` y conservar handles visibles durante polling.
- [ ] Recordar qué queda fuera de NGP: la compra de juegos de pago la valida
      Luna Negra y los webhooks firmados siguen siendo HMAC server-to-server.
- [ ] Sesión que persista: token de sesión (no re-firmar en cada reload), token-first
      (no bloquear en el firmador) y esperar `window.nostr`. Ver skill `nostr-tool`.
- [ ] Si soportás Room Link / invitaciones a sala: `?join=<id>` unir-o-CREAR (lazy),
      con `buildRoomLink`/`parseRoomLink` del SDK; probar que dos personas con el mismo
      link caen en la misma sala.
- [ ] Marcador verificado: firmar el `kind:31338` con una clave de oráculo de SERVIDOR
      (`buildAttestationEvent`) y **declarar su pubkey** como `["oracle", pk]` en el
      `kind:30023` del juego; si no, Luna no lo confía (`isAuthorizedAttestation`).
- [ ] Zaps: ventana holgada (~6 s) al fetch del `lud16`, exigir `allowsNostr`, y anclar
      con `["a", gameCoord]` en el 9734 si querés atribuir la propina al juego.
- [ ] Secretos (NGE/oráculo) en el runtime del server, no en la imagen; al deployar,
      preservá los secretos que ya estaban en el env de runtime.
- [ ] Verificar detección con un modo de prueba (`?ngptest=1`) aislado y removible;
      recordar que 31338/NGE necesitan el server y el zap necesita un pago real.

## Referencias del repo

- SDK del protocolo (wire NGP + NGE, cliente y helpers de firma):
  [`nostr-game-protocol`](https://github.com/soyezequiel/Nostr-Game-Protocol)
- Spec de Nostr Games Protocol (NGP): `docs/nostr-games-protocol.md`
- Apuestas NGP (kinds 1339/1341/31340): `docs/nostr-games-protocol-apuestas.md`
- Salas e invitaciones NGP: `docs/nostr-games-protocol-salas-invitaciones.md`
- Room Link de Luna (`?join`, contrato del enlace): `docs/luna-room-link.md`
- Implementación de NGP: `docs/nostr-games-protocol-implementacion.md`
