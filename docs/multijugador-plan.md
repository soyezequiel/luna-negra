# Plan D · Multijugador / unirse a la sala de un amigo

> Esfuerzo: **M–L** · **Fuera del MVP** (Fase D) · Reusa el patrón de entitlements.

## Principio de arquitectura
La sala/lobby WebSocket **la hostea el proveedor**, no Luna Negra. Luna Negra se
queda **serverless** y solo **emite tokens** y (opcional) lleva un **registro de
salas** para descubrirlas. Nada de esto necesita worker always-on — salvo que
Luna Negra hiciera *signaling* en tiempo real, cosa que evitamos por diseño.

El patrón ya existe: `play-token` + `entitlements/verify` (JWT corto + endpoint
público con CORS que el server del juego consulta). D1 lo clona para invitaciones.

## D1 · Invite token + endpoint de unión
- **Nuevo token** en `src/lib/auth.ts`: `signInvite` / `verifyInvite`
  (`purpose: "invite"`), payload `{ npub, gameId, roomId, host: boolean, exp }`,
  corto (~15 min), copiando el bloque de `signEntitlement`.
- `POST /api/games/[id]/invite` (autenticado): verifica que el jugador **posee el
  juego** (reusar la lógica de ownership de `play-token`) → mintea el invite →
  devuelve la **URL de unión** al lobby del proveedor con el token (`?invite=...`).
- `GET /api/rooms/verify?token=...` (**público, CORS abierto** como
  `entitlements/verify`): el lobby lo llama para validar al que entra →
  `{ valid, npub, gameId, roomId, host }`.

## D2 · Contrato para proveedores (docs)
- Documentar cómo el proveedor expone su WebSocket, recibe el token (query param o
  subprotocolo), lo valida contra `/api/rooms/verify` y mapea `npub → jugador`.
  Análogo a la doc de entitlements.

## D3 · Presencia "jugando ahora" (NIP-38)
- Al lanzar un juego, auto-publicar **kind 30315** (NIP-38) con el juego. Revisar
  `src/lib/nostr-social.ts` por helpers de publicación existentes.
- En `/friends`, mostrar la presencia de los amigos y un botón **"Unirse"** cuando
  estén en una sala unible.

## Decisión clave antes de codear: ¿cómo se descubre la sala?
| Opción | Cómo | Trade-off |
|---|---|---|
| **A) Solo link de invitación** | El host genera el invite y lo comparte (copiar/pegar o DM Nostr) | Cero estado en Luna Negra, el más simple. Sin "lista de salas de amigos" |
| **B) Registro de salas en DB** | Tabla `Room` (id, gameId, hostUserId, status) → `/friends` lista salas unibles | Descubrimiento real. Suma un modelo, pero **sigue sin always-on** |
| **C) Descubrimiento vía Nostr** | El evento NIP-38 del amigo referencia la sala | Sin DB extra, encaja con la filosofía Nostr. Depende de relays, más frágil |

**Recomendación:** **A** para un primer corte (invite + verify + docs), y **B** si
se quiere la experiencia "veo a mi amigo jugando y me uno con un click".

## Implicaciones de infra
- Luna Negra: **serverless intacto** (mint de tokens + opcional registro de salas).
- El lobby WebSocket: **del proveedor**.
- Always-on solo haría falta si Luna Negra hiciera matchmaking/signaling en vivo
  (lo evitamos).
