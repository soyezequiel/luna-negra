# @lunanegra/sdk

SDK para validar los tokens de Luna Negra en tu **game server**. Verifica
**offline** (con la clave pública del JWKS) los tokens de acceso (entitlement) y de
invitación a sala (invite) — sin llamar a Luna Negra en cada request.

## Instalar
```bash
npm i jose   # peer dependency
```
Copiá `index.ts` a tu proyecto (o instalá el paquete cuando esté publicado).

## Uso

```ts
import { createClient } from "@lunanegra/sdk";

const luna = createClient({
  baseUrl: "https://luna-negra-three.vercel.app",
});

// Acceso pago (token que viene en ?lnToken= al abrir el juego)
const ent = await luna.verifyAccess(token);
if (!ent) return res.status(403).end();         // bloquear
console.log("compró:", ent.npub, ent.gameId);

// Unirse a una sala multijugador (token del lobby)
const room = await luna.verifyRoom(inviteToken);
if (!room || room.roomId !== expectedRoom) return reject();
// Identidad ESTABLE del jugador: usá npub/pubkey como playerId, nunca un UUID local.
const playerId = room.pubkey;
console.log(playerId, "se une", room.host ? "(host)" : `(host real: ${room.hostNpub})`);

// Nombre/avatar son solo presentación y NO viajan en el token (verifyRoom es offline).
// Refrescalos cuando los necesites para la UI:
const profile = await luna.getPlayerProfile(room.npub);
if (profile) console.log(profile.displayName, profile.avatarUrl);
```

`verifyAccess` / `verifyRoom` devuelven `null` si el token es inválido o expiró
(`room.expiresAt` es ISO 8601, útil para mostrar un mensaje claro al usuario).

## Cómo funciona
- Los tokens son JWT **ES256**. El SDK trae la clave pública de
  `/.well-known/jwks.json` (cacheada) y valida la firma + `iss`/`aud`/`exp`/`scope`.
- No hay round-trip a Luna Negra por request. La referencia completa de la API está
  en `/developers` (OpenAPI).
