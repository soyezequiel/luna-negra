# Multijugador · contrato para proveedores

> Implementa la Fase D con **link de invitación** (sin registro de salas en DB).
> Luna Negra **emite y valida tokens**; el **lobby en tiempo real lo hostea el
> proveedor**. Ver el plan en [`multijugador-plan.md`](multijugador-plan.md).

## Flujo
1. El dueño del juego abre la página del juego y toca **"Jugar con amigos"**.
   - `POST /api/games/:id/invite` (sin body) → mintea un **invite token** de host y
     genera un `roomId`. Devuelve `{ token, roomId, host: true, slug }`.
   - La UI muestra un **link para compartir**: `/(game)/:slug?room=:roomId`.
   - Se abre el juego del proveedor con `?inviteToken=<token>&room=<roomId>`.
2. Un amigo abre el link. Si está logueado y **posee el juego**:
   - `POST /api/games/:id/invite` con `{ roomId }` → mintea su propio token
     (`host: false`) atado a su npub.
   - Se abre el juego del proveedor con `?inviteToken=<token>&room=<roomId>`.

El token es un JWT corto (30 min) firmado por Luna Negra. Payload:
`{ npub, pubkey, gameId, slug, roomId, host, hostNpub, hostPubkey, scope: "invite" }`.
`hostNpub`/`hostPubkey` identifican al host original de la sala (null en salas
externas/legacy sin registrar).

## Cómo lo valida el proveedor
El lobby del proveedor recibe `inviteToken` y `room` (query param o subprotocolo
del WebSocket) y los valida contra Luna Negra:

```
GET https://<luna-negra>/api/v1/rooms/verify
Authorization: Bearer <inviteToken>
→ 200 {
    valid: true,
    npub, pubkey,                  // identidad ESTABLE del jugador (usar como playerId)
    displayName, avatarUrl,        // presentación (pueden ser null), NO identidad
    gameId, slug, roomId, host,
    hostNpub, hostPubkey,          // host original de la sala (null si externa/legacy)
    expiresAt                      // ISO 8601: cuándo caduca la invitación
  }
→ 200 { valid: false }            // token inválido/expirado
```

El endpoint es **público con CORS abierto** (se puede llamar desde otro origen).
Reglas para el proveedor:
- Rechazar la conexión si `valid !== true`.
- Verificar que `roomId` coincide con la sala a la que se conecta.
- Usar `npub`/`pubkey` como identidad del jugador en la sala (nunca un UUID local).
- `displayName`/`avatarUrl` son solo para la UI; refrescables con
  `GET /api/v1/players/:npub/profile` → `{ npub, pubkey, displayName, avatarUrl }`.
- `host: true` marca a quien creó la sala (útil para permisos de la partida).
- `hostNpub`/`hostPubkey` permiten a los invitados saber quién es el host real.
- `expiresAt` permite mostrar un error claro cuando la invitación expiró.

## Presencia «Jugando» (derivada de la API)

Los amigos del jugador ven un badge **«🎮 Jugando <juego> en Luna Negra»** (estado
NIP-38, kind:30315). Ese estado lo **firma la pestaña de la tienda** con la llave
Nostr del jugador (`window.nostr`) — el juego **nunca toca Nostr**. Tampoco hay
acoplamiento de ventana (`window.opener`, `postMessage`): **el juego solo reporta
su presencia por la API** y Luna Negra deriva el estado social de ahí.

Flujo:
1. El juego late su presencia a Luna Negra cada ~10s mientras el jugador esté
   activo: `POST /api/v1/presence` (Bearer **API key** del proveedor, server-side)
   con `{ npub, status, game?, roomId }`. La presencia tiene TTL ~30s. `game` (slug
   o id, opcional) separa la curva de concurrentes por juego cuando la API key cubre
   varios; sin él, los juegos del proveedor comparten la curva.
2. La pestaña de la tienda sondea su propia presencia: `GET /api/me/playing` (auth
   por cookie de sesión). Mientras la API confirme `playing: true`, **renueva** el
   estado NIP-38; cuando deja de confirmarlo (el juego cerró → la presencia
   caducó), lo **limpia**.

Reglas:
- El juego **no** necesita conocer Nostr, ni abrir sin `noopener`, ni postear a
  `window.opener`. Todo va por la interfaz REST de Luna Negra.
- Al cerrar el juego, la presencia de la API caduca por TTL (~30s) y la tienda baja
  el estado. La tienda publica el estado **optimista** al lanzar y lo retira solo
  si el juego nunca reporta dentro de una gracia inicial (~30s).
- El estado NIP-38 lleva una expiración corta (NIP-40), así se auto-limpia aunque
  la propia tienda muera sin poder publicar el `clear`.

> Un juego con backend reporta presencia con `POST /api/v1/presence` (su API key),
> que alimenta `GET /api/me/playing`.

## Infraestructura
- Luna Negra: **serverless** (solo mint + verify de tokens). No hostea el lobby.
- El **WebSocket/realtime lo corre el proveedor** en su subdominio.
- No hace falta worker always-on en Luna Negra para esto.

## Nota: lobby para juegos sin servidor propio
Un juego estático (sin servidor propio) puede armar su lobby con **presencia por
polling contra el backend** de Luna Negra:

```
POST /api/v1/rooms/:roomId/presence   (Authorization: Bearer <inviteToken>)
body: { clientId, score, leave? }
→ 200 { members: [{ clientId, npub, host, score }] }
```

Cada cliente postea su puntaje cada ~2s (heartbeat) y recibe el roster de la sala.
La identidad (`npub`/`host`) sale del **token verificado**, no del cliente. El estado
vive en Postgres (`RoomPresence`), con TTL de 15s (sin heartbeat = fuera), así que
funciona **entre navegadores y dispositivos distintos** de forma confiable en
serverless.

> **Por qué no relays Nostr:** se probó usar eventos efímeros sobre relays públicos
> y, aunque los relays *aceptan* el evento, **no lo retransmiten** a los demás
> suscriptores de forma confiable (ni cross-conexión). Por eso este camino usa el
> backend. Un proveedor real puede usar su propio WebSocket validando el token con
> `GET /api/rooms/verify` (contrato de arriba).
