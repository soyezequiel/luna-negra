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

## Apuestas / escrow (pozo winner-takes-all)

Requiere `apiKey` (`ln_sk_…`) en `createClient({ baseUrl, apiKey })`.

```ts
// 1) Crear el pozo
const bet = await luna.createBet({
  gameId, participants: [npub1, npub2], stakeSats: 10,
  victoryCondition: "primero a 100", roomId, metadata: { matchId },
});
// bet.netPayoutSats, bet.feeSats, bet.potTargetSats…

// 2) Repartir los handles de pago a cada jugador
const { deposits } = await luna.getBetDeposits(bet.betId);
// deposits[i] = { npub, depositStatus, bolt11, lnurl, payUrl }

// 3) Consultar estado cuando quieras
const info = await luna.getBet(bet.betId);   // info.status, info.potSats, …

// 4a) Resolver (vacío = empate/anulación → reembolso total)
const evt = luna.buildResultEvent(bet.betId, [npubGanador]);
await luna.reportResult(bet.betId, finalizeEvent(evt, miClave));

// 4b) …o cancelar antes de resolver (reembolsa depósitos)
await luna.cancelBet(bet.betId);
```

Webhooks (firma HMAC, verificá con `verifyWebhook`): `deposit.received`, `bet.funded`,
`bet.settled`, `bet.cancelled`, `bet.expired`, `bet.refunded`. Los de apuesta traen
`roomId`/`metadata` para correlacionar con tu sala.

## Cómo funciona
- Los tokens son JWT **ES256**. El SDK trae la clave pública de
  `/.well-known/jwks.json` (cacheada) y valida la firma + `iss`/`aud`/`exp`/`scope`.
- No hay round-trip a Luna Negra por request. La referencia completa de la API está
  en `/developers` (OpenAPI).
