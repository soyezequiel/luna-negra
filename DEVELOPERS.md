# Integrar tu juego con Luna Negra

Luna Negra es una tienda de juegos **web**. Vos hosteás tu juego donde quieras;
Luna Negra te da visibilidad, cobra a los jugadores y te paga.

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

## 6. Feed de actividad (opcional)
Para que tus novedades aparezcan en la pestaña **Actividad** del juego, publicá una
nota de Nostr (kind:1) con el tag:

```
["t", "lunanegra:game:<slug>"]
```

Tanto vos como los jugadores pueden postear ahí.

Ejemplo de juego integrado: [`public/demo-game/index.html`](public/demo-game/index.html).
