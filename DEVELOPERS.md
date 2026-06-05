# Integrar tu juego con Luna Negra

Tutorial completo para desarrolladores. **Vos hosteás tu juego donde quieras**;
Luna Negra aporta visibilidad, identidad (Nostr), cobros en Lightning, multijugador,
apuestas con escrow y webhooks — todo vía una API estándar.

> 📖 **Referencia interactiva (OpenAPI):** `/developers` · spec en `/openapi.json`
> 📦 **SDK de TypeScript:** [`sdk/`](sdk/) (`@lunanegra/sdk`)
> 🎮 **Ejemplo funcionando:** [`public/demo-game/index.html`](public/demo-game/index.html)

---

## Cómo funciona (modelo mental)

```
Jugador  ──compra/juega──►  Luna Negra  ──token / webhook──►  Tu juego (lo hosteás vos)
                              (tienda)                          (consumís la API)
```

- La **identidad** del jugador es su **npub** (Nostr). Luna Negra maneja el login;
  tu juego solo recibe el npub ya verificado dentro de un token.
- Luna Negra **cobra** al jugador y te paga tu parte (por defecto **70%**) a tu
  Lightning Address.
- Tu juego **consume tokens y webhooks** para saber quién compró, quién se une a una
  sala y cómo resolver apuestas.

### Conceptos clave
| Concepto | Qué es |
|---|---|
| **npub** | Identidad Nostr del jugador (pública). |
| **entitlement token** | JWT corto que prueba que el jugador tiene acceso a tu juego. |
| **invite token** | JWT que prueba que un jugador puede unirse a una sala multijugador. |
| **API key** (`ln_sk_…`) | Credencial server-to-server de tu proveedor (crear apuestas). |
| **webhook secret** (`whsec_…`) | Secreto para verificar la firma de los webhooks. |

### Convenciones de la API (v1)
- **Base URL:** `https://<LUNA_NEGRA>` (tu deploy, ej. `luna-negra-three.vercel.app`).
- **Auth:** siempre `Authorization: Bearer <token-o-api-key>`.
- **Errores:** `{ "error": { "code": "…", "message": "…" } }` + status HTTP correcto.
- **CORS** habilitado en los endpoints públicos.

### SDK (recomendado)
El SDK te ahorra escribir `fetch`/JWT a mano:
```bash
npm i jose          # peer dependency
# copiá sdk/index.ts a tu proyecto (o instalá @lunanegra/sdk cuando esté publicado)
```
```ts
import { createClient } from "@lunanegra/sdk";
const luna = createClient({ baseUrl: "https://<LUNA_NEGRA>", apiKey: "ln_sk_…" });
```

---

## Paso 1 · Publicá tu juego
En el panel **/provider** (login con tu extensión Nostr nos2x/Alby):
1. Creá tu **perfil de proveedor** con tu **Lightning Address** (ahí cobrás).
2. Creá un juego: título, descripción, **precio en sats**, categoría y la **URL de tu
   juego** (`gameUrl`).
3. **Enviar a revisión** → un admin lo aprueba y queda publicado en la tienda.

## Paso 2 · Cobros (no integrás nada)
Cuando un jugador compra, Luna Negra cobra el total por Lightning y te transfiere tu
parte automáticamente, en sats. Para enterarte por código, usá el webhook
`purchase.completed` (Paso 6).

## Paso 3 · Verificá el acceso (entitlements)
Cuando el jugador toca **Jugar**, Luna Negra abre tu `gameUrl` con un token en la
query:
```
https://tu-juego.com/?lnToken=<JWT>
```

### Opción A — Verificación OFFLINE (recomendada)
El token es un **JWT ES256**. Validalo localmente con la clave pública del JWKS, sin
llamar a Luna Negra. Con el SDK:
```ts
const ent = await luna.verifyAccess(token);   // del ?lnToken=
if (!ent) return block();                       // inválido/expirado
console.log("acceso:", ent.npub, ent.gameId, ent.slug);
```
A mano (con `jose`):
```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
const JWKS = createRemoteJWKSet(new URL("https://<LUNA_NEGRA>/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: "luna-negra",
  audience: "lunanegra:game",
});
if (payload.scope !== "entitlement") throw new Error("token equivocado");
```
> Claims: `iss`, `aud` (`lunanegra:game`), `sub` (npub), `exp` (5 min), `scope`.

### Opción B — Verificación por endpoint (más simple)
Si no querés verificar JWT vos mismo:
```
GET https://<LUNA_NEGRA>/api/v1/entitlements/verify
Authorization: Bearer <lnToken>
→ 200 { "valid": true, "npub": "…", "gameId": "…", "slug": "…" }
→ 200 { "valid": false }     // inválido/expirado
```

> Verificá el token **en tu backend** antes de servir contenido pago. En el cliente
> solo para UX. Juegos gratis: `verifyAccess` igual devuelve el entitlement.

## Paso 4 · Multijugador / jugar con amigos
Luna Negra emite **invite tokens** de sala; **vos hosteás el lobby** (WebSocket) y
validás a quien se une:
```ts
const room = await luna.verifyRoom(inviteToken);   // del ?inviteToken=&room=
if (!room || room.roomId !== expectedRoom) return reject();
console.log(room.npub, "se une", room.host ? "(host)" : "");
```
O por endpoint: `GET /api/v1/rooms/verify` con `Authorization: Bearer <inviteToken>`
→ `{ valid, npub, gameId, slug, roomId, host }`.

Flujo completo (crear sala, descubrir por Nostr, contrato del lobby) en
[`docs/multijugador-contrato.md`](docs/multijugador-contrato.md).

## Paso 5 · Apuestas / escrow
Tu game server crea apuestas y Luna Negra **custodia el pozo** y paga a los
ganadores (menos un fee configurable). Necesitás una **API key** (panel /provider →
"Claves de API"; se muestra una sola vez).

**Crear una apuesta:**
```ts
const bet = await luna.createBet({
  gameId: "…",
  participants: ["npub1…", "npub1…"],   // ≥2, usuarios de Luna Negra
  stakeSats: 10,
  victoryCondition: "primero en llegar a 100",
});
// bet.betId, bet.contractEventId (contrato firmado en Nostr), bet.depositDeadline
```
Equivalente HTTP: `POST /api/v1/bets` con `Authorization: Bearer ln_sk_…`.
> **Reintentos seguros:** mandá `Idempotency-Key: <único>` — reintentar con la misma
> key devuelve la respuesta original **sin crear otra apuesta**.

**Reportar el resultado** (tu firma Nostr es la prueba del oráculo):
```ts
const evt = luna.buildResultEvent(bet.betId, ["npub1ganador…"]);
const signed = finalizeEvent(evt, miClaveNostr);   // lo firmás vos (nostr-tools)
await luna.reportResult(bet.betId, signed);
```
Equivalente HTTP: `POST /api/v1/bets/{betId}/result` con `{ "event": <firmado> }`.

> 🔒 **Confianza:** el contrato (stake, fee, participantes) se **publica firmado en
> Nostr** al crear la apuesta. Antes de pagar, Luna Negra recalcula el hash y lo
> compara: si los términos fueron alterados (`CONTRACT_MISMATCH`), **no paga**.

## Paso 6 · Webhooks
Configurá una **URL de webhook** en /provider. Luna Negra te avisa (POST JSON, con
reintentos) cuando pasa algo:

| Evento | Cuándo |
|---|---|
| `purchase.completed` | un jugador compró tu juego |
| `bet.settled` | una apuesta se resolvió y se pagó |
| `payout.sent` | te enviamos tu parte |

Cada request trae `X-LunaNegra-Event` y `X-LunaNegra-Signature` (HMAC-SHA256 del
cuerpo con tu secreto). Verificá la firma:
```ts
import { verifyWebhook } from "@lunanegra/sdk";
// rawBody = cuerpo CRUDO (sin parsear)
if (!verifyWebhook(rawBody, req.headers["x-lunanegra-signature"], secret)) {
  return res.status(401).end();
}
const { id, type, data } = JSON.parse(rawBody);
// type: "purchase.completed" | "bet.settled" | "payout.sent"
```

## Paso 7 · Feed de actividad (opcional)
Para que tus novedades aparezcan en la pestaña **Actividad** de tu juego, publicá una
nota de Nostr (kind:1) con el tag:
```
["t", "lunanegra:game:<slug>"]
```
Vos y los jugadores pueden postear ahí.

---

## Referencia rápida de endpoints
| Método | Endpoint | Auth | Para |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | — | Validar tokens offline |
| GET | `/api/v1/entitlements/verify` | Bearer (entitlement) | Confirmar compra |
| GET | `/api/v1/rooms/verify` | Bearer (invite) | Validar quien se une |
| POST | `/api/v1/bets` | Bearer (API key) | Crear apuesta |
| POST | `/api/v1/bets/{id}/result` | Evento Nostr firmado | Reportar ganador |

## Checklist de integración
- [ ] Publicaste tu juego en /provider (con Lightning Address).
- [ ] En tu juego, leés `?lnToken=` y verificás el acceso (offline con JWKS).
- [ ] (Multijugador) tu lobby valida `inviteToken` con `verifyRoom`.
- [ ] (Apuestas) creaste una API key y usás `createBet` / `reportResult`.
- [ ] Configuraste un webhook y verificás su firma HMAC.
