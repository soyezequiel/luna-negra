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
console.log(room.npub, "se une", room.host ? "(host)" : "");
```

`verifyAccess` / `verifyRoom` devuelven `null` si el token es inválido o expiró.

## Cómo funciona
- Los tokens son JWT **ES256**. El SDK trae la clave pública de
  `/.well-known/jwks.json` (cacheada) y valida la firma + `iss`/`aud`/`exp`/`scope`.
- No hay round-trip a Luna Negra por request. La referencia completa de la API está
  en `/developers` (OpenAPI).
