# Luna Room Link · estándar de enlace de invitación a sala

> ℹ️ **Nota:** con la retirada de la interfaz REST 1.0, el endpoint de este flujo
> se movió de `/api/v1/rooms/invite` a **`POST /api/rooms/invite`** (misma
> semántica, cookie de sesión). Otros endpoints `/api/v1/*` que este documento
> menciona (verificación de compra, JWKS, `invites/route.ts`) fueron **eliminados**.
>
> **Estado: implementado** (núcleo + UI + doc del contrato). Este documento define un
> estándar de **enlace de invitación** para que cualquier juego integrado se
> beneficie de "Invitar a jugar" **desde Luna Negra, sin que el que invita tenga
> que abrir el juego primero**, y sin que la sala tenga que existir de antemano.
>
> Complementa —no reemplaza— a [`multijugador-contrato.md`](multijugador-contrato.md)
> (salas hosteadas por Luna, tokens `invite`) y a
> [`nostr-games-protocol-salas-invitaciones.md`](nostr-games-protocol-salas-invitaciones.md)
> (capa NGP / retos NIP-17).

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
4. La UI principal usa enlace **público** (cualquiera lo abre y entra). La variante
   **dirigida** (solo el `npub` invitado entra) queda como capacidad técnica para
   retos cerrados, torneos o apuestas.
5. Cualquier juego que implemente el contrato (§ "Contrato del juego") **aparece
   con botón "Invitar"** en Luna, sin código a medida por juego.

## Decisiones de diseño (fijadas)

- **El estado de la sala vive en el backend del juego.** Luna **no** hostea el
  tablero de esta sala ni registra una fila `Room`. Esto la diferencia de
  [`multijugador-contrato.md`](multijugador-contrato.md), donde la sala es de Luna
  (tabla `Room` + `mintRoomInvite`). Los dos modelos **conviven**.
- **La identidad la resuelve el juego, no Luna.** Room Link **no es
  retro-compatible**: el juego loguea al jugador por **Nostr (NIP-07 / NIP-46)** en
  su propio dominio. Luna **nunca** mintea un token de identidad (`lnToken`) para
  este flujo. Para un juego **pago**, Luna sigue siendo el gate de compra (verifica
  la propiedad por REST); para uno gratis, no interviene.
- **El dinero y la custodia se quedan en la 1.0.** Este estándar es solo del enlace
  + entrada a sala. Apuestas/escrow siguen en §7 de la guía de integración.
- **Interface-agnóstico.** El enlace es una URL normal. Nostr (NIP-17) es un
  **canal de entrega opcional** encima, no lo que define el estándar.

## El enlace canónico

```
https://<Game.gameUrl>/?join=<roomId>
```

| Param      | Qué es | Quién lo pone | ¿Obligatorio? |
|------------|--------|---------------|---------------|
| `join`   | id de sala, string URL-safe opaco (`^[A-Za-z0-9_-]{1,64}$`). No pre-existe: el juego lo crea *lazy*. | Luna o el juego | sí |
| `lnOrigin` | origen de Luna (informativo), cuando el link lo abre Luna. | Luna | no |

> **Sin token de identidad.** El enlace es una URL pelada: **no** lleva `lnToken` ni
> ningún token de sesión. La identidad la resuelve el juego por Nostr (ver
> "Identidad" abajo). El viejo `lnInvite` (variante dirigida a un `npub`) fue
> **removido**; Room Link es solo público.

> **`join` es nuevo y distinto de `room`.** El par `room` + `inviteToken` que ya
> usa el launcher (`launchGameRoom` en [`room-launch.ts`](src/lib/room-launch.ts))
> es para salas **hosteadas por Luna**. `join` señala una sala **hosteada por el
> juego**. Un juego puede soportar ambos; el contrato de abajo es solo para `join`.

### Solo variante pública

Cualquiera con el enlace entra: el enlace es público. El juego exige **identidad**
(que quien abre tenga un `npub`, resuelto por Nostr — ver abajo), no un permiso por
persona. La variante **dirigida** (un `lnInvite` atado a un `npub`) fue **removida**:
para fijar participantes o retos cerrados se usa la capa NGP (retos NIP-17), no este
estándar.

## Identidad (la resuelve el juego, no Luna)

Room Link **no es retro-compatible**: no hay handoff de `lnToken` desde Luna. El
enlace lleva el dominio del juego, y sea cual sea la forma de entrar, **el juego
resuelve la identidad por Nostr en su propio cliente** (NIP-07 `window.nostr` o
NIP-46 con un firmador remoto tipo Amber/Alby). Luna nunca mintea identidad para
este flujo.

### 1. Abierto desde Luna (botón "Invitar" / "Jugar")
Luna abre el juego en su dominio con el link **limpio** (solo `join` + `lnOrigin`,
sin token):

```
https://<Game.gameUrl>/?join=<roomId>&lnOrigin=<luna>
```

El juego, al cargar, hace el login Nostr. Si el jugador ya tiene una identidad Nostr
activa (NIP-07/46), el firmador la reusa sin re-preguntar.

### 2. Enlace crudo reenviado (WhatsApp, Discord…) — **cold open**
El enlace `…/?join=<id>` cae en el juego sin identidad. Contrato del juego:
detectar "tengo `join` pero no sé quién es el jugador" y **pedir la firma por
Nostr (NIP-07/46) ahí mismo** — sin rebotar a Luna. La identidad es el `npub` que
firma.

### Juego pago: gate de compra (lo único que sigue en Luna)
Verificar la **propiedad** de un juego pago no tiene equivalente Nostr (Luna es la
vendedora/custodia — ver [`capability-mode.ts`](src/lib/capability-mode.ts)). Para
eso, y solo eso, el juego consulta a Luna por REST
([`GET /api/v1/entitlements/verify`](src/app/api/v1/entitlements/verify/route.ts))
con el `npub` del jugador. Es una llamada de datos, **no** un redirect de identidad.
Un juego **gratis** no toca Luna en absoluto.

> Nota: el endpoint [`/launch/<slug>`](src/app/launch/[slug]/page.tsx) sigue
> existiendo como **puerta de compra** (para juegos pagos: valida sesión y propiedad
> y devuelve al juego con el link limpio), pero **ya no mintea `lnToken`** — su ramal
> fuerza identidad Nostr
> ([`sessions/route.ts`](src/app/api/games/[id]/sessions/route.ts)). `returnTo` se
> valida siempre contra `Game.gameUrl` (anti open-redirect).

## Contrato del juego (qué implementa quien adopta el estándar)

Al cargar, el juego:

1. Lee `join`. Si falta → arranque normal (no hay sala).
2. Si hay `join` pero **no sabe quién es el jugador** → **login Nostr**
   (NIP-07 `window.nostr` / NIP-46) en su propio cliente. La identidad es el `npub`
   firmante. **No** rebota a Luna.
3. (Solo juegos pagos) verificar la propiedad contra Luna por REST
   (`GET /api/v1/entitlements/verify` con el `npub`). Gratis → omitir.
4. **Si la sala `join` no existe en mi backend → crearla** (host = el primero en
   entrar); si existe → unirse.
5. Descartar los params de la URL (`history.replaceState`) para no dejar basura en
   el historial.

El juego declara soporte con un toggle en el panel de integración (capability
`roomLink`, ver inventario) — solo así Luna muestra el botón "Invitar". Como la
identidad es por Nostr, **implementar Room Link implica soportar login NIP-07/46**.

## Token dirigido `lnInvite` — **removido**

La variante dirigida (un JWT `lnInvite` que autorizaba a un solo `npub`) fue
**eliminada**: Room Link es solo público y sin tokens en el enlace. Para fijar
participantes en un reto cerrado, usar la capa NGP (retos NIP-17), no este estándar.

## Lo que provee Luna (endpoints)

| Necesidad | Endpoint | Auth |
|-----------|----------|------|
| Generar el enlace público sin abrir el juego ni crear una `Room` | **`POST /api/rooms/invite`** → `{ roomId, inviteUrl }` | sesión del jugador (cookie) — **no** API key |
| Puerta de compra del cold-open (juegos pagos): valida propiedad y devuelve al juego con el link **limpio** | **`GET /launch/<slug>?returnTo=…`** → redirige a `<gameUrl>?join=…&lnOrigin=…` (sin `lnToken`) | sesión (o login) |
| Verificar propiedad de un juego pago | **`GET /api/v1/entitlements/verify`** (por `npub`) | — |

`inviteUrl` lo arma Luna con `Game.gameUrl`: `<Game.gameUrl>?join=…`. Siempre
público, sin tokens en el enlace.

## Entrega por Nostr (opcional)

El enlace ya es una URL portable. NIP-17 solo lo **transporta** a un amigo concreto:
reusar el reto NGP (`kind:14`) poniendo `["url", "<inviteUrl>"]` y, si aplica,
`["room", roomId]`. Es 1-a-1 cifrado → encaja con la variante **dirigida**. La
variante **pública** se comparte como link pelado (DM NIP-04, copiar/pegar, QR).
Ver mecánica NIP-17 en [`nostr-games-protocol-salas-invitaciones.md`](nostr-games-protocol-salas-invitaciones.md).

---

## Inventario: qué existe hoy vs qué hay que construir

> **Nota (histórica).** Esta tabla es el plan de build original. El estándar ya está
> implementado y el **modelo de identidad cambió**: no hay `lnToken`/JWKS ni
> `lnInvite` en Room Link — la identidad es por Nostr (NIP-07/46) del lado del juego.
> Leé las filas de abajo con eso en mente (los ítems #1, #3 y #4 quedaron obsoletos
> en su parte de identidad/token).

### Ya existe (reusar)

| Pieza | Dónde | Nota |
|-------|-------|------|
| Tokens ES256 verificables offline (JWKS) | [`auth.ts`](src/lib/auth.ts): `signEntitlement`/`verifyEntitlement` (`lnToken`, 5m) y `signInvite`/`verifyInvite` (`inviteToken`, 30m) | El `lnInvite` nuevo se firma con las **mismas** `getSigningKeys()` |
| JWKS público | `GET /.well-known/jwks.json` (`api/v1/jwks`) | El juego ya lo usa en §2; sirve igual para `lnInvite` |
| Apertura del juego con token en su **propio dominio** | [`room-launch.ts`](src/lib/room-launch.ts): `launchStandaloneGame` (`?lnToken=`), `launchGameRoom` (`?inviteToken=&room=`) | Ya adjunta token a `Game.gameUrl`; falta la variante `?join=` |
| Mint de invitación desde sesión first-party (sin API key, sin abrir el juego) | [`api/invites/route.ts`](src/app/api/invites/route.ts) `POST` | **Pero** arma `inviteUrl` al **dominio de Luna** (`/game/<slug>?room=`) y crea una `GameInvite` dirigida. Hay que derivar la variante game-domain |
| Validación anti-open-redirect de `inviteUrl` | [`api/v1/invites/route.ts:42`](src/app/api/v1/invites/route.ts) `isAllowedInviteUrl` | Reusar para validar `returnTo` del cold-open |
| Verificación de propiedad del juego antes de invitar | [`rooms.ts`](src/lib/rooms.ts) `mintRoomInvite`, [`api/invites/route.ts`](src/app/api/invites/route.ts) | Misma lógica de `owns` |
| Mecanismo de capacidades declaradas por juego | `Game.manualCaps` (Json) + `MANUAL_CAP_KEYS` en [`integration-ngp.ts:199`](src/lib/integration-ngp.ts) | Agregar clave `roomLink` acá |
| Entrega por Nostr (NIP-17 reto, NIP-04 DM link) | [`invite.ts`](src/lib/invite.ts) `buildInviteMessage`/`parseInvite` | El parseo hoy matchea `/game/<slug>?room=`; extender para `?join=` |
| `Game.gameUrl` (dominio registrado del juego) | `prisma/schema.prisma` `model Game` | Ya es la fuente para armar el link |

### Hay que construir

| # | Qué | Por qué no existe hoy | Tamaño |
|---|-----|----------------------|--------|
| 1 | **`GET /launch/<slug>?returnTo=…`**: SSO que autentica y redirige (302) al dominio del juego con `lnToken` + `join` preservados. Validar `returnTo` contra `Game.gameUrl`. | Hoy el juego siempre se abre **desde** Luna con el token ya adjunto (`window.open`). Un enlace crudo que cae frío en el juego no tiene forma de recuperar identidad. **Es el mayor trabajo.** | M |
| 2 | **`POST /api/rooms/invite`** (sesión, no API key) → `{ roomId, inviteUrl, lnInvite? }`. Arma `inviteUrl = <Game.gameUrl>?join=…[&lnInvite=…]`. **No** crea fila `Room`. | El mint actual (`/api/invites`, `mintRoomInvite`) arma URL de dominio Luna y/o crea `Room` hosteada por Luna. | S |
| 3 | **Token `lnInvite`** (`scope:"room-invite"`, atado a `toNpub`, sin semántica de sala-Luna): `signRoomInvite`/`verifyRoomInvite` en [`auth.ts`](src/lib/auth.ts). | El `invite` actual va atado al que abre y asume sala de Luna. | S |
| 4 | **Variante `?join=` en el launcher** cliente ([`room-launch.ts`](src/lib/room-launch.ts)): abrir `<gameUrl>?join=&lnToken=` para el camino "desde Luna". | Hoy solo hay `launchStandaloneGame` (`lnToken`) y `launchGameRoom` (`inviteToken`+`room`). | S |
| 5 | **Capability `roomLink`** en el catálogo de integración ([`integration-ngp.ts`](src/lib/integration-ngp.ts)) + toggle en el panel del proveedor + **gating del botón "Invitar"** en la ficha ([`game/[slug]/page.tsx`](src/app/game/[slug]/page.tsx), hoy usa `supportsRooms = Boolean(game.gameUrl)`). | No hay flag para "soporta sala hosteada por el juego con Luna Room Link". | S |
| 6 | **UI "Invitar"**: botón en la ficha / panel multijugador que llama a `POST /api/rooms/invite` y usa el link público como flujo normal para copiar o mandar a amigos. | El panel actual ([`multiplayer-panel.tsx`](src/components/multiplayer-panel.tsx)) crea salas hosteadas por Luna. | M |
| 7 | **Extender el parseo de invitaciones** ([`invite.ts`](src/lib/invite.ts) `INVITE_RE`) para reconocer enlaces `?join=` con dominio del juego (además del `/game/<slug>?room=` actual). | El regex actual matchea solo el path de Luna. | S |
| 8 | **Doc del contrato para proveedores** (los 6 pasos de "Contrato del juego") en la guía de integración / skill `integrar-luna-negra-1-0`. | Nuevo. | S |

### Fuera de alcance (explícito)

- **Estado de sala en tiempo real**: lo hostea el juego. Luna no toca `Room`/
  `RoomPresence` para salas `join`. (Si un juego no tiene backend, que use el
  modelo de [`multijugador-contrato.md`](multijugador-contrato.md), no este.)
- **Dinero / apuestas**: se quedan en la 1.0 (§7).

## Notas de seguridad

- **Enlace público = cualquiera entra.** No poner datos sensibles en `join`; es
  un identificador opaco, no un secreto. El control de acceso real (si lo hay) lo
  hace el juego.
- **`returnTo` validado siempre** contra `Game.gameUrl`/hosts del proveedor
  (open-redirect / phishing).
- **Identidad = firma Nostr** (NIP-07/46): el juego confía en el `npub` que firma,
  no en un token de Luna. No es dinero: autoriza a jugar/entrar, nada más. El
  resultado de una apuesta sigue viniendo del game server (§7).
- **Descartar los params de la URL** tras leerlos (paso 5 del contrato).

## Preguntas abiertas

- ¿Nombre del param: `join` (propuesto) o reusar `room`? Reusar `room` ahorra un
  concepto pero se pisa con el flujo de sala-Luna (`room`+`inviteToken`). Propongo
  `join` para desambiguar.
- ¿El cold-open (`/launch/<slug>`, solo juegos pagos) abre el juego en la **misma**
  pestaña (redirect) o preabre una nueva? Para un enlace reenviado, misma pestaña es
  lo natural.
