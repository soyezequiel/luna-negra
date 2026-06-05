# Integrar tu juego con Luna Negra

Luna Negra es una tienda de juegos **web**. Vos hosteás tu juego donde quieras;
Luna Negra te da visibilidad, cobra a los jugadores y te paga.

> 📖 **Referencia interactiva (OpenAPI):** `/developers` · spec en `/openapi.json`.
> 📦 **SDK de TypeScript:** [`sdk/`](sdk/) (`@lunanegra/sdk`) para validar tokens en
> tu game server sin escribir nada a mano.

## 1. Publicar
1. Entrá con tu **Nostr** (extensión nos2x/Alby) y andá a **Proveedor**.
2. Creá tu perfil con tu **Lightning Address** (ahí cobrás el payout).
3. Creá un juego (título, descripción, precio en sats, **URL del juego**).
4. **Enviar a revisión** → un admin lo aprueba y queda publicado.

## 2. Cobros
Cuando un jugador compra, Luna Negra cobra el total por Lightning y te transfiere
tu parte (por defecto **70%**) a tu Lightning Address automáticamente. Todo en sats.

## 3. Lanzar el juego
Cuando el jugador toca **Jugar**, Luna Negra abre tu `gameUrl` en una pestaña con
un token de acceso en la query:

```
https://tu-juego.com/?lnToken=<JWT>
```

Usar ese token es **opcional**: si no lo verificás, tu juego igual funciona.

## 4. Verificar acceso (API de entitlements · v1)
Para confirmar que el jugador realmente compró, validá el token contra la **API
v1** pasándolo en el header `Authorization: Bearer` (CORS habilitado):

```
GET https://<luna-negra>/api/v1/entitlements/verify
Authorization: Bearer <lnToken>
```

Respuesta:

```json
{ "valid": true, "npub": "npub1…", "gameId": "…", "slug": "tu-juego" }
```

Ejemplo en el cliente del juego:

```js
const token = new URLSearchParams(location.search).get("lnToken");
const r = await fetch("https://<luna-negra>/api/v1/entitlements/verify", {
  headers: { Authorization: "Bearer " + token },
});
const { valid, npub } = await r.json();
if (!valid) {
  // bloquear / modo invitado
}
```

> Mejor aún: validá el token **en tu backend** antes de servir contenido pago.

### Verificación OFFLINE (recomendado, sin llamar a Luna Negra)
Los tokens son **JWT firmados con ES256**. Podés validarlos localmente con la clave
pública publicada en el JWKS estándar — más rápido y sin depender de Luna Negra:

```
GET https://<luna-negra>/.well-known/jwks.json
```

```js
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://<luna-negra>/.well-known/jwks.json"),
);

const { payload } = await jwtVerify(token, JWKS, {
  issuer: "luna-negra",        // claim iss
  audience: "lunanegra:game",  // claim aud
});
// payload: { scope: "entitlement", npub, gameId, slug, exp, … }
if (payload.scope !== "entitlement") throw new Error("token equivocado");
```

> Claims: `iss` (issuer), `aud` (`lunanegra:game`), `sub` (npub), `exp` (5 min) y
> `scope` (`entitlement` o `invite`). El endpoint `/verify` de arriba es una
> alternativa más simple si no querés verificar JWT vos mismo.

### Convenciones de la API v1
- **Auth:** token en `Authorization: Bearer <token>`.
- **Errores:** forma estándar `{ "error": { "code": "MISSING_TOKEN", "message": "…" } }`
  con el status HTTP correcto (400/401/…). Un token inválido/expirado devuelve
  `200 { "valid": false }`.

## 5. Multijugador / jugar con amigos (v1)
Luna Negra emite **invite tokens** de sala; vos hosteás el lobby (WebSocket) y
validás a quien se une:

```
GET https://<luna-negra>/api/v1/rooms/verify
Authorization: Bearer <inviteToken>
→ { "valid": true, "npub": "…", "gameId": "…", "slug": "…", "roomId": "…", "host": true }
```

Detalle completo del flujo en [`docs/multijugador-contrato.md`](docs/multijugador-contrato.md).

## 6. Apuestas / escrow (v1)
Tu game server crea apuestas y Luna Negra **custodia el pozo** y paga a los
ganadores. Necesitás una **API key** (creala en el panel **/provider** → "Claves de
API"; se muestra una sola vez).

**Crear** (auth con API key):
```
POST https://<luna-negra>/api/v1/bets
Authorization: Bearer ln_sk_…
{ "gameId": "…", "participants": ["npub1…","npub1…"], "stakeSats": 10, "victoryCondition": "…" }
→ 201 { "betId", "contractEventId", "depositDeadline" }
```
Al crearla, Luna Negra **publica el contrato firmado en Nostr** (`contractEventId`)
para que los jugadores verifiquen los términos.

> **Reintentos seguros:** mandá un header `Idempotency-Key: <único>`. Si reintentás
> con la misma key, recibís la respuesta original **sin crear otra apuesta**.

**Reportar el resultado** (auth = evento Nostr **firmado por vos**, el proveedor —
la firma es la prueba del oráculo):
```
POST https://<luna-negra>/api/v1/bets/{betId}/result
{ "event": <evento Nostr firmado con tags ["bet", betId] y ["winner", npub]> }
→ 200 { "ok": true }
```
Antes de pagar, Luna Negra recalcula el hash de los términos y lo compara con el
contrato firmado: si no coincide (`CONTRACT_MISMATCH`), **no paga**.

> Con el SDK: `luna.createBet({...})`, `luna.buildResultEvent(betId, winners)` (lo
> firmás con tu clave Nostr) y `luna.reportResult(betId, signedEvent)`.

## 7. Webhooks
Configurá una **URL de webhook** en el panel **/provider**. Luna Negra te avisa
(POST JSON, con reintentos vía QStash) cuando pasa:

| Evento | Cuándo |
|---|---|
| `purchase.completed` | un jugador compró tu juego |
| `bet.settled` | una apuesta se resolvió y se pagó |
| `payout.sent` | te enviamos tu parte (70%) |

Cada request trae las cabeceras `X-LunaNegra-Event` y `X-LunaNegra-Signature`
(HMAC-SHA256 del cuerpo con tu **secreto de webhook**). Verificá la firma:

```ts
import { verifyWebhook } from "@lunanegra/sdk";

// rawBody = cuerpo crudo (sin parsear). secret = tu secreto del panel.
if (!verifyWebhook(rawBody, req.headers["x-lunanegra-signature"], secret)) {
  return res.status(401).end();
}
const { type, data } = JSON.parse(rawBody);
```

Cuerpo: `{ id, type, created, data }`.

## 8. Feed de actividad (opcional)
Para que tus novedades aparezcan en la pestaña **Actividad** del juego, publicá una
nota de Nostr (kind:1) con el tag:

```
["t", "lunanegra:game:<slug>"]
```

Tanto vos como los jugadores pueden postear ahí.

Ejemplo de juego integrado: [`public/demo-game/index.html`](public/demo-game/index.html).
