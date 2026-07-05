# Luna Room Link · estándar de enlace de invitación a sala

> **Estado: implementado** (núcleo + UI + doc del contrato). Este documento define un
> estándar de **enlace de invitación** para que cualquier juego integrado se
> beneficie de "Invitar a jugar" **desde Luna Negra, sin que el que invita tenga
> que abrir el juego primero**, y sin que la sala tenga que existir de antemano.
>
> Complementa —no reemplaza— a [`multijugador-contrato.md`](multijugador-contrato.md)
> (salas hosteadas por Luna, tokens `invite`) y a
> [`perfil-juego-nostr-salas-invitaciones.md`](perfil-juego-nostr-salas-invitaciones.md)
> (capa 2.0 / retos NIP-17).

## Qué problema resuelve

Hoy, para invitar a alguien a una sala hace falta que el jugador **entre al juego**
(o al menos a su ficha) para que Luna mintee un token de sala y arme el link. Y el
link que se comparte apunta al **dominio de Luna** (`/game/<slug>?room=…`), rebota
por la ficha de la tienda, y siempre va **dirigido a una persona concreta** (el
token `invite` viene atado a un `npub`).

Queremos un estándar donde:

1. **Luna arma el enlace sola**, desde la ficha del juego, sin abrir el juego —
   porque ya conoce la URL registrada de cada juego (`Game.gameUrl`).
2. El enlace **lleva el dominio del juego** (p. ej. `https://tetra.tu-dominio/…`),
   no el de Luna.
3. La sala **no necesita pre-existir**: el juego la crea *lazy* al primer acceso.
4. Hay **dos variantes**: enlace **público** (cualquiera lo abre y entra) y enlace
   **dirigido** (solo el `npub` invitado entra).
5. Cualquier juego que implemente el contrato (§ "Contrato del juego") **aparece
   con botón "Invitar"** en Luna, sin código a medida por juego.

## Decisiones de diseño (fijadas)

- **El estado de la sala vive en el backend del juego.** Luna **no** hostea el
  tablero de esta sala ni registra una fila `Room`. Luna solo emite identidad y,
  para la variante dirigida, un token de autorización. Esto la diferencia de
  [`multijugador-contrato.md`](multijugador-contrato.md), donde la sala es de Luna
  (tabla `Room` + `mintRoomInvite`). Los dos modelos **conviven**.
- **El dinero y la custodia se quedan en la 1.0.** Este estándar es solo del enlace
  + entrada a sala. Apuestas/escrow siguen en §7 de la guía de integración.
- **Interface-agnóstico.** El enlace es una URL normal. Nostr (NIP-17) es un
  **canal de entrega opcional** encima, no lo que define el estándar.

## El enlace canónico

```
https://<Game.gameUrl>/?lnRoom=<roomId>[&lnInvite=<jwt>]
```

| Param      | Qué es | Quién lo pone | ¿Obligatorio? |
|------------|--------|---------------|---------------|
| `lnRoom`   | id de sala, string URL-safe opaco (`^[A-Za-z0-9_-]{1,64}$`). No pre-existe: el juego lo crea *lazy*. | Luna o el juego | sí |
| `lnInvite` | JWT ES256 firmado por Luna que autoriza a **un** `npub` a esta sala. Solo en la variante **dirigida**. | Luna | no |
| `lnToken`  | entitlement de identidad (§1 SSO). **No viaja en el enlace compartible**; se adjunta en el handoff de identidad (ver abajo). | Luna al abrir | en runtime |

> **`lnRoom` es nuevo y distinto de `room`.** El par `room` + `inviteToken` que ya
> usa el launcher (`launchGameRoom` en [`room-launch.ts`](src/lib/room-launch.ts))
> es para salas **hosteadas por Luna**. `lnRoom` señala una sala **hosteada por el
> juego**. Un juego puede soportar ambos; el contrato de abajo es solo para `lnRoom`.

### Variante pública vs dirigida

- **Pública** (sin `lnInvite`): cualquiera con el enlace entra. El juego solo exige
  identidad (que el que abre esté logueado, vía `lnToken`).
- **Dirigida** (con `lnInvite`): el juego verifica el `lnInvite` contra el JWKS y
  **exige que el jugador == `toNpub`** del token. Encaja con el reto 1v1 NIP-17.

## Handoff de identidad (la pieza crítica)

El enlace lleva el dominio del juego, así que hay **dos formas de entrar** y el
estándar cubre las dos:

### 1. Abierto desde Luna (botón "Invitar" / "Jugar")
Luna abre el juego adjuntando el entitlement, igual que hoy hace `launchStandaloneGame`
([`room-launch.ts:101`](src/lib/room-launch.ts)):

```
https://<Game.gameUrl>/?lnRoom=<roomId>&lnToken=<entitlement>&lnOrigin=<luna>
```

La identidad ya viene resuelta. Es el camino feliz.

### 2. Enlace crudo reenviado (WhatsApp, Discord…) — **cold open**
El enlace `…/?lnRoom=<id>` cae en el juego **sin `lnToken`**. Contrato del juego:
detectar "tengo `lnRoom` pero no `lnToken`" y **rebotar a Luna SSO preservando el
room**:

```
https://<luna>/launch/<slug>?returnTo=<url-original-urlencoded>
```

Luna autentica (o reusa la sesión), mintea un entitlement fresco y **redirige de
vuelta al dominio del juego** con `lnToken` + `lnRoom` intactos. **Este endpoint de
launch/return no existe hoy y es el mayor trabajo del lado tienda** (ver inventario).

> Nota de seguridad: `returnTo` debe validarse contra `Game.gameUrl` del `slug` (o
> la allowlist de hosts del proveedor, como ya hace `isAllowedInviteUrl` en
> [`api/v1/invites/route.ts:42`](src/app/api/v1/invites/route.ts)). Nunca redirigir a
> un host arbitrario (open-redirect).

## Contrato del juego (qué implementa quien adopta el estándar)

Al cargar, el juego:

1. Lee `lnRoom`. Si falta → arranque normal (no hay sala).
2. Si hay `lnRoom` pero **no** `lnToken` → **rebotar a Luna SSO** con `returnTo`
   (cold open). Al volver, re-ejecuta desde el paso 1 ya con token.
3. Con `lnToken`: verificar identidad (offline vía JWKS, como en §2 de la guía).
4. Si hay `lnInvite`: verificar firma vía JWKS y **exigir `jugador == toNpub`**;
   si no coincide, rechazar (o degradar a espectador, decisión del juego).
5. **Si la sala `lnRoom` no existe en mi backend → crearla** (host = el primero en
   entrar); si existe → unirse.
6. Descartar los params de la URL (`history.replaceState`) para no dejar tokens en
   el historial.

El juego declara soporte con un toggle en el panel de integración (capability
`roomLink`, ver inventario) — solo así Luna muestra el botón "Invitar".

## Token dirigido `lnInvite` (nuevo)

JWT ES256 firmado con las mismas claves que el entitlement (verificable offline por
el juego con el JWKS que ya consume en §2). Payload propuesto:

```jsonc
{
  "scope": "room-invite",     // distinto de "entitlement" y de "invite"
  "gameId": "game_…",
  "slug": "tetra",
  "roomId": "<lnRoom>",
  "toNpub": "npub1…",         // el único autorizado a entrar
  "iss": "luna-negra",
  "aud": "lunanegra:game",
  "exp": "<~1h>"
}
```

Se diferencia del token `invite` actual ([`auth.ts:249`](src/lib/auth.ts)) en dos
cosas: (a) **no** va atado a la identidad del que abre (`npub`/`pubkey`), sino al
**destinatario** (`toNpub`); (b) **no** asume una sala hosteada por Luna
(sin `host`/`hostNpub`/`hostPubkey`). Es autocontenido: el juego lo valida sin
llamar a `rooms/verify`.

## Lo que provee Luna (endpoints)

| Necesidad | Endpoint propuesto | Auth |
|-----------|-------------------|------|
| Generar enlace (público o dirigido) sin abrir el juego ni crear una `Room` | **`POST /api/v1/rooms/invite`** → `{ roomId, inviteUrl, lnInvite? }` | sesión del jugador (cookie) — **no** API key |
| Cold-open SSO con retorno al dominio del juego | **`GET /launch/<slug>?returnTo=…`** → 302 a `<gameUrl>?lnRoom=…&lnToken=…` | sesión (o login) |
| Firmar `lnInvite` | interno, reusa `getSigningKeys()` de [`auth.ts`](src/lib/auth.ts) | — |

`inviteUrl` lo arma Luna con `Game.gameUrl`. Público = sin `lnInvite`; dirigido =
se pasa `toNpub` y se firma el token.

## Entrega por Nostr (opcional)

El enlace ya es una URL portable. NIP-17 solo lo **transporta** a un amigo concreto:
reusar el reto 2.0 (`kind:14`) poniendo `["url", "<inviteUrl>"]` y, si aplica,
`["room", roomId]`. Es 1-a-1 cifrado → encaja con la variante **dirigida**. La
variante **pública** se comparte como link pelado (DM NIP-04, copiar/pegar, QR).
Ver mecánica NIP-17 en [`perfil-juego-nostr-salas-invitaciones.md`](perfil-juego-nostr-salas-invitaciones.md).

---

## Inventario: qué existe hoy vs qué hay que construir

### Ya existe (reusar)

| Pieza | Dónde | Nota |
|-------|-------|------|
| Tokens ES256 verificables offline (JWKS) | [`auth.ts`](src/lib/auth.ts): `signEntitlement`/`verifyEntitlement` (`lnToken`, 5m) y `signInvite`/`verifyInvite` (`inviteToken`, 30m) | El `lnInvite` nuevo se firma con las **mismas** `getSigningKeys()` |
| JWKS público | `GET /.well-known/jwks.json` (`api/v1/jwks`) | El juego ya lo usa en §2; sirve igual para `lnInvite` |
| Apertura del juego con token en su **propio dominio** | [`room-launch.ts`](src/lib/room-launch.ts): `launchStandaloneGame` (`?lnToken=`), `launchGameRoom` (`?inviteToken=&room=`) | Ya adjunta token a `Game.gameUrl`; falta la variante `?lnRoom=` |
| Mint de invitación desde sesión first-party (sin API key, sin abrir el juego) | [`api/invites/route.ts`](src/app/api/invites/route.ts) `POST` | **Pero** arma `inviteUrl` al **dominio de Luna** (`/game/<slug>?room=`) y crea una `GameInvite` dirigida. Hay que derivar la variante game-domain |
| Validación anti-open-redirect de `inviteUrl` | [`api/v1/invites/route.ts:42`](src/app/api/v1/invites/route.ts) `isAllowedInviteUrl` | Reusar para validar `returnTo` del cold-open |
| Verificación de propiedad del juego antes de invitar | [`rooms.ts`](src/lib/rooms.ts) `mintRoomInvite`, [`api/invites/route.ts`](src/app/api/invites/route.ts) | Misma lógica de `owns` |
| Mecanismo de capacidades declaradas por juego | `Game.manualCaps` (Json) + `MANUAL_CAP_KEYS` en [`integration-2.ts:199`](src/lib/integration-2.ts) | Agregar clave `roomLink` acá |
| Entrega por Nostr (NIP-17 reto, NIP-04 DM link) | [`invite.ts`](src/lib/invite.ts) `buildInviteMessage`/`parseInvite` | El parseo hoy matchea `/game/<slug>?room=`; extender para `?lnRoom=` |
| `Game.gameUrl` (dominio registrado del juego) | `prisma/schema.prisma` `model Game` | Ya es la fuente para armar el link |

### Hay que construir

| # | Qué | Por qué no existe hoy | Tamaño |
|---|-----|----------------------|--------|
| 1 | **`GET /launch/<slug>?returnTo=…`**: SSO que autentica y redirige (302) al dominio del juego con `lnToken` + `lnRoom` preservados. Validar `returnTo` contra `Game.gameUrl`. | Hoy el juego siempre se abre **desde** Luna con el token ya adjunto (`window.open`). Un enlace crudo que cae frío en el juego no tiene forma de recuperar identidad. **Es el mayor trabajo.** | M |
| 2 | **`POST /api/v1/rooms/invite`** (sesión, no API key) → `{ roomId, inviteUrl, lnInvite? }`. Arma `inviteUrl = <Game.gameUrl>?lnRoom=…[&lnInvite=…]`. **No** crea fila `Room`. | El mint actual (`/api/invites`, `mintRoomInvite`) arma URL de dominio Luna y/o crea `Room` hosteada por Luna. | S |
| 3 | **Token `lnInvite`** (`scope:"room-invite"`, atado a `toNpub`, sin semántica de sala-Luna): `signRoomInvite`/`verifyRoomInvite` en [`auth.ts`](src/lib/auth.ts). | El `invite` actual va atado al que abre y asume sala de Luna. | S |
| 4 | **Variante `?lnRoom=` en el launcher** cliente ([`room-launch.ts`](src/lib/room-launch.ts)): abrir `<gameUrl>?lnRoom=&lnToken=` para el camino "desde Luna". | Hoy solo hay `launchStandaloneGame` (`lnToken`) y `launchGameRoom` (`inviteToken`+`room`). | S |
| 5 | **Capability `roomLink`** en el catálogo de integración ([`integration-2.ts`](src/lib/integration-2.ts)) + toggle en el panel del proveedor + **gating del botón "Invitar"** en la ficha ([`game/[slug]/page.tsx`](src/app/game/[slug]/page.tsx), hoy usa `supportsRooms = Boolean(game.gameUrl)`). | No hay flag para "soporta sala hosteada por el juego con Luna Room Link". | S |
| 6 | **UI "Invitar"**: botón en la ficha / panel multijugador que llama a `POST /api/v1/rooms/invite`, muestra el link para copiar (público) y/o selector de amigo (dirigido). | El panel actual ([`multiplayer-panel.tsx`](src/components/multiplayer-panel.tsx)) crea salas hosteadas por Luna. | M |
| 7 | **Extender el parseo de invitaciones** ([`invite.ts`](src/lib/invite.ts) `INVITE_RE`) para reconocer enlaces `?lnRoom=` con dominio del juego (además del `/game/<slug>?room=` actual). | El regex actual matchea solo el path de Luna. | S |
| 8 | **Doc del contrato para proveedores** (los 6 pasos de "Contrato del juego") en la guía de integración / skill `integrar-luna-negra-1-0`. | Nuevo. | S |

### Fuera de alcance (explícito)

- **Estado de sala en tiempo real**: lo hostea el juego. Luna no toca `Room`/
  `RoomPresence` para salas `lnRoom`. (Si un juego no tiene backend, que use el
  modelo de [`multijugador-contrato.md`](multijugador-contrato.md), no este.)
- **Dinero / apuestas**: se quedan en la 1.0 (§7).

## Notas de seguridad

- **Enlace público = cualquiera entra.** No poner datos sensibles en `lnRoom`; es
  un identificador opaco, no un secreto. El control de acceso real (si lo hay) lo
  hace el juego.
- **`returnTo` validado siempre** contra `Game.gameUrl`/hosts del proveedor
  (open-redirect / phishing).
- **`lnInvite` es falsificable-resistente** (firmado por Luna) pero **no es dinero**:
  autoriza entrada a sala, nada más. El resultado de una apuesta sigue viniendo del
  game server (§7).
- **Descartar tokens de la URL** tras canjearlos (paso 6 del contrato).

## Preguntas abiertas

- ¿Nombre del param: `lnRoom` (propuesto) o reusar `room`? Reusar `room` ahorra un
  concepto pero se pisa con el flujo de sala-Luna (`room`+`inviteToken`). Propongo
  `lnRoom` para desambiguar.
- ¿El cold-open (`/launch/<slug>`) abre el juego en la **misma** pestaña (redirect)
  o preabre una nueva? Para un enlace reenviado, misma pestaña es lo natural.
- ¿TTL del `lnInvite` dirigido? Propongo ~1h (como `GameInvite`,
  [`api/invites/route.ts:9`](src/app/api/invites/route.ts)).
