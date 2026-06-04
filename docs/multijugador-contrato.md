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
`{ npub, pubkey, gameId, slug, roomId, host, purpose: "invite" }`.

## Cómo lo valida el proveedor
El lobby del proveedor recibe `inviteToken` y `room` (query param o subprotocolo
del WebSocket) y los valida contra Luna Negra:

```
GET https://<luna-negra>/api/rooms/verify?token=<inviteToken>
→ 200 { valid: true, npub, gameId, slug, roomId, host }
→ 200 { valid: false }            // token inválido/expirado
```

El endpoint es **público con CORS abierto** (se puede llamar desde otro origen).
Reglas para el proveedor:
- Rechazar la conexión si `valid !== true`.
- Verificar que `roomId` coincide con la sala a la que se conecta.
- Usar `npub` como identidad del jugador en la sala.
- `host: true` marca a quien creó la sala (útil para permisos de la partida).

## Infraestructura
- Luna Negra: **serverless** (solo mint + verify de tokens). No hostea el lobby.
- El **WebSocket/realtime lo corre el proveedor** en su subdominio.
- No hace falta worker always-on en Luna Negra para esto.

## Nota sobre el juego demo
El juego demo de Luna Negra (`public/demo-game`) es estático (sin servidor). Su
lobby usa **relays Nostr** como transporte (eventos efímeros kind `20987` tagueados
con la sala, sobre los mismos relays que la app), así que la presencia y el puntaje
de equipo se sincronizan **entre navegadores y dispositivos distintos** sin
necesidad de un servidor. Es un stand-in válido para ver el flujo completo
comprar→invitar→unirse→jugar; un proveedor real puede usar este mismo enfoque o su
propio WebSocket, validando el token con el contrato de arriba.

> Requiere conexión a internet (relays). Cada cliente firma con una clave efímera
> generada en el navegador; la identidad mostrada (`npub`) viene del token de
> invitación verificado, no de esa clave.
