# Integrar tu juego con Luna Negra — guía para quien recién empieza

> Esta es la versión **didáctica** de [`DEVELOPERS.md`](DEVELOPERS.md).
> Tiene el **mismo código y los mismos pasos**, pero explicando cada concepto y cada
> tecnología desde cero. Si ya manejás JWT, webhooks y firmas HMAC, andá directo al
> documento original (es más corto). Si esas palabras te suenan a chino, quedate acá.

Vas a aprender lo justo y necesario de: **Nostr**, **Lightning**, **JWT/JWKS**,
**webhooks**, **HMAC** y **escrow**. No hace falta saber nada de eso para arrancar.

> 📖 **Referencia interactiva (OpenAPI):** `/developers` · spec en `/openapi.json`
> 📦 **SDK de TypeScript:** [`sdk/`](sdk/) (`@lunanegra/sdk`)
> 🎮 **Ejemplo funcionando:** [`public/demo-game/index.html`](public/demo-game/index.html)

---

## Antes de escribir código: el panorama

Luna Negra es una **tienda de juegos estilo Steam**, pero con dos diferencias:

1. **Los jugadores pagan con Bitcoin** por una red llamada **Lightning** (pagos
   instantáneos y muy baratos; la unidad chica se llama *sat*).
2. **Tu juego sigue viviendo en tu propio servidor.** Luna Negra no aloja tu juego;
   te da visibilidad, cobra por vos, identifica a los jugadores y te avisa de las cosas
   importantes. Todo eso lo hace a través de una **API**.

> **¿Qué es una API?** Es la "puerta" por la que dos programas se hablan. Tu juego le
> hace pedidos a Luna Negra (por HTTP, como cualquier página web) y Luna Negra
> responde con datos en formato JSON. Nada más exótico que eso.

### El dibujo mental

```
Jugador  ──compra/juega──►  Luna Negra  ──token / webhook──►  Tu juego (lo hosteás vos)
                              (tienda)                          (consumís la API)
```

- La **identidad** del jugador es su **npub** (su usuario en Nostr; ver abajo). Vos no
  manejás contraseñas: Luna Negra ya verificó quién es y te lo pasa.
- Luna Negra **cobra** al jugador y te paga tu parte (por defecto **70%**) a tu
  dirección de cobro Lightning.
- Tu juego **recibe tokens y webhooks** para saber quién compró, quién entra a una
  sala y cómo resolver apuestas.

---

## El vocabulario, explicado

Tomate dos minutos para esto: el resto del documento usa estas palabras todo el tiempo.

### Nostr y el `npub`
**Nostr** es un protocolo de identidad y mensajes descentralizado. Lo único que
necesitás saber: cada persona tiene un **par de claves** (como un usuario y una
contraseña, pero criptográficas):

- La **clave pública** se muestra como `npub1...` → es el **identificador público** del
  jugador. Es lo que vos recibís y usás para saber "quién es".
- La **clave privada** (`nsec1...`) nunca sale del dispositivo del jugador. Sirve para
  **firmar** cosas y probar que fue él, sin revelar la clave.

> Analogía: el `npub` es como tu número de cuenta (lo podés compartir); la clave
> privada es la firma de tu puño y letra (no la mostrás, pero podés firmar con ella).

Para el login, el jugador usa una **extensión de navegador** (nos2x o Alby) que guarda
su clave y firma por él. Vos no tocás nada de esto: te llega el `npub` ya verificado.

### Lightning y los `sats`
**Lightning** es una red sobre Bitcoin para pagos chicos, instantáneos y baratos. Un
**sat** (satoshi) es la unidad mínima de Bitcoin (1 BTC = 100.000.000 sats). Tu juego
pone el precio en sats y cobrás en sats.

Tu "alias de cobro" es una **Lightning Address**: se ve como un email
(`vos@billetera.com`) y es a donde te llega tu parte. La sacás de tu billetera Lightning
(Alby, Wallet of Satoshi, etc.).

### Token (y por qué es un "JWT")
Un **token** es un "pase digital" temporal que prueba algo. Luna Negra usa un tipo
estándar llamado **JWT** (*JSON Web Token*).

> **¿Qué es un JWT?** Es un texto largo con tres partes separadas por puntos
> (`xxxxx.yyyyy.zzzzz`). En el medio lleva datos (quién sos, para qué juego, cuándo
> vence) y al final una **firma criptográfica**. Esa firma te deja **verificar que el
> token lo emitió Luna Negra y nadie lo alteró**, sin tener que llamar a Luna Negra.

Hay dos tipos de token en esta API:
- **entitlement token**: prueba que el jugador **compró/tiene acceso** a tu juego.
- **invite token**: prueba que el jugador **puede unirse a una sala** multijugador.

### API key y webhook secret
- **API key** (`ln_sk_…`): una clave secreta que identifica a **tu servidor** ante Luna
  Negra (la usás para crear apuestas). Es server-to-server: **nunca** la pongas en el
  navegador ni en el código del cliente.
- **webhook secret** (`whsec_…`): un secreto compartido para verificar que un webhook
  (ver abajo) realmente vino de Luna Negra y no de un impostor.

### Webhook
Normalmente *tu* programa le pregunta cosas a la API. Un **webhook** es al revés: Luna
Negra **te avisa a vos** cuando pasa algo (alguien compró, una apuesta se resolvió).
Para eso, vos le das una URL y Luna Negra le hace un `POST` con los datos cuando ocurre
el evento.

> Analogía: en vez de llamar cada cinco minutos para preguntar "¿llegó mi pedido?",
> dejás tu número y te llaman cuando llega.

### HMAC (la firma de los webhooks)
Cuando Luna Negra te manda un webhook, ¿cómo sabés que fue Luna Negra y no cualquiera
que descubrió tu URL? Con **HMAC**: una "firma" calculada a partir del cuerpo del
mensaje **+ tu webhook secret**. Vos recalculás esa firma con el mismo secreto; si
coincide, el mensaje es auténtico. Si no, lo rechazás.

### Escrow
En las apuestas, **escrow** es un "depósito en garantía": Luna Negra **retiene el pozo**
de la apuesta mientras dura la partida y recién le paga al ganador cuando se confirma el
resultado. Así nadie se queda con la plata antes de tiempo.

---

## Convenciones de la API (v1) — leelo una vez

- **Base URL:** `https://<LUNA_NEGRA>` (el deploy de la tienda, ej.
  `luna-negra-three.vercel.app`). En los ejemplos, reemplazá `<LUNA_NEGRA>` por esa URL.
- **Autenticación:** siempre mandás una cabecera HTTP
  `Authorization: Bearer <token-o-api-key>`. ("Bearer" = "el que porta este token tiene
  acceso"; es el estándar de la web.)
- **Errores:** cuando algo falla, la respuesta trae
  `{ "error": { "code": "…", "message": "…" } }` y un código de estado HTTP acorde
  (401 = no autorizado, 400 = pedido mal formado, etc.).
- **CORS habilitado** en los endpoints públicos (podés llamarlos desde el navegador sin
  que te lo bloquee por seguridad de origen cruzado).

### Usá el SDK (te ahorra dolores de cabeza)

Podés hablar con la API a mano (`fetch` + armar/verificar JWT vos mismo), pero hay un
**SDK** que ya hace lo difícil. Recomendado, sobre todo si recién empezás:

```bash
npm i jose          # peer dependency (librería para manejar JWT)
# copiá sdk/index.ts a tu proyecto (o instalá @lunanegra/sdk cuando esté publicado)
```
```ts
import { createClient } from "@lunanegra/sdk";
const luna = createClient({ baseUrl: "https://<LUNA_NEGRA>", apiKey: "ln_sk_…" });
```

> A lo largo de la guía vas a ver, para cada paso, **la forma con el SDK** (corta) y
> **el equivalente HTTP crudo** (para que entiendas qué pasa por debajo).

---

## Paso 1 · Publicá tu juego

Esto es por interfaz, no por código. En el panel **/provider** (entrás con tu extensión
Nostr nos2x o Alby):

1. Creá tu **perfil de proveedor** con tu **Lightning Address** (ahí vas a cobrar).
2. Creá un juego: título, descripción, **precio en sats**, categoría y la **URL de tu
   juego** (`gameUrl`) — la dirección web donde realmente vive tu juego.
3. **Enviar a revisión** → un admin lo aprueba y queda publicado en la tienda.

---

## Paso 2 · Cobros (no integrás nada)

Cuando un jugador compra, Luna Negra cobra el total por Lightning y te transfiere tu
parte automáticamente, en sats. **No tenés que programar nada de pagos.** Si querés
enterarte por código de cada compra (para desbloquear contenido, llevar registro, etc.),
usás el webhook `purchase.completed` del Paso 6.

---

## Paso 3 · Verificá el acceso (entitlements)

Este es el primer paso donde sí escribís código en tu juego.

Cuando el jugador toca **Jugar** en la tienda, Luna Negra abre tu `gameUrl` y le agrega
un token a la URL:

```
https://tu-juego.com/?lnToken=<JWT>
```

Tu trabajo: **leer ese `lnToken` y verificar que es válido** antes de dejar entrar. Hay
dos formas.

### Opción A — Verificación OFFLINE (recomendada)

"Offline" significa que verificás el token **vos mismo, sin llamar a Luna Negra**. Suena
difícil pero el SDK lo resuelve en una línea:

```ts
const ent = await luna.verifyAccess(token);   // 'token' es el valor del ?lnToken=
if (!ent) return block();                      // null = inválido o vencido → no dejes entrar
console.log("acceso:", ent.npub, ent.gameId, ent.slug);
```

¿Cómo funciona por debajo? El token es un **JWT firmado con un algoritmo llamado ES256**
(firma con clave pública/privada). Luna Negra publica su **clave pública** en una URL
estándar llamada **JWKS** (`/.well-known/jwks.json`). Con esa clave pública podés
comprobar la firma, pero no podés falsificar tokens (para eso haría falta la clave
privada, que solo tiene Luna Negra).

A mano, con la librería `jose`:

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";

// JWKS = el "llavero" público de Luna Negra. jose lo descarga y cachea solo.
const JWKS = createRemoteJWKSet(new URL("https://<LUNA_NEGRA>/.well-known/jwks.json"));

const { payload } = await jwtVerify(token, JWKS, {
  issuer: "luna-negra",        // quién emitió el token (debe ser Luna Negra)
  audience: "lunanegra:game",  // para quién es (juegos)
});
if (payload.scope !== "entitlement") throw new Error("token equivocado");
```

> **Claims** (los datos dentro del token): `iss` (emisor), `aud` (audiencia,
> `lunanegra:game`), `sub` (el npub del jugador), `exp` (vencimiento, 5 minutos) y
> `scope`. Si `jwtVerify` no lanza error, el token es legítimo y no fue alterado.

### Opción B — Verificación por endpoint (más simple de entender)

Si no querés lidiar con JWT, le preguntás directamente a Luna Negra si el token sirve:

```
GET https://<LUNA_NEGRA>/api/v1/entitlements/verify
Authorization: Bearer <lnToken>

→ 200 { "valid": true, "npub": "…", "gameId": "…", "slug": "…" }
→ 200 { "valid": false }     // inválido o vencido
```

Es más fácil de leer, pero hace una llamada de red por cada verificación (la Opción A no
necesita red una vez que cacheó el JWKS).

> ⚠️ **Importante:** verificá el token **en tu backend** antes de servir contenido pago.
> Hacerlo solo en el navegador es para UX (mostrar/ocultar cosas), pero un usuario
> malicioso puede saltearse el cliente. Para juegos gratis, `verifyAccess` igual
> devuelve el entitlement (así sabés quién es el jugador).

---

## Paso 4 · Multijugador / jugar con amigos (opcional)

Si tu juego tiene salas (multijugador), Luna Negra emite **invite tokens**, pero **el
lobby lo hosteás vos** (típicamente con un **WebSocket** — una conexión en vivo entre el
navegador del jugador y tu servidor, para mensajes en tiempo real).

Cuando alguien intenta unirse a una sala, llega con un token y vos lo validás:

```ts
const room = await luna.verifyRoom(inviteToken);    // viene de ?inviteToken=&room=
if (!room || room.roomId !== expectedRoom) return reject();

// La identidad REAL del jugador es su Nostr, no un número que invente el navegador.
// Usá npub o pubkey como "playerId" — son estables y únicos.
const playerId = room.pubkey;
console.log(playerId, "se une", room.host ? "(es el host)" : `(host real: ${room.hostNpub})`);

// El nombre y el avatar son solo para mostrar (pueden venir vacíos) y NO viajan en el
// token. Pedilos aparte cuando los necesites para la UI:
const perfil = await luna.getPlayerProfile(room.npub);
if (perfil) console.log("mostrar:", perfil.displayName, perfil.avatarUrl);
```

O por endpoint, si preferís HTTP crudo:
`GET /api/v1/rooms/verify` con `Authorization: Bearer <inviteToken>`
→ `{ valid, npub, pubkey, displayName, avatarUrl, gameId, slug, roomId, host, hostNpub, hostPubkey, expiresAt }`.

Qué significa cada cosa:

- **`npub` / `pubkey`** → la identidad **estable** del jugador. Usala como su ID; nunca
  generes un identificador local en el navegador.
- **`displayName` / `avatarUrl`** → solo para mostrar (pueden ser `null`). Si los querés
  frescos sin depender del token, pedilos a `GET /api/v1/players/:npub/profile`
  → `{ npub, pubkey, displayName, avatarUrl }`.
- **`host: true`** → marca a quien **creó** la sala.
- **`hostNpub` / `hostPubkey`** → así un invitado sabe **quién es el host real** de la sala.
- **`expiresAt`** → cuándo caduca la invitación, para mostrar un error claro si ya venció.

> El flujo completo (crear la sala, que los jugadores la descubran por Nostr, y el
> "contrato" de cómo debe comportarse tu lobby) está en
> [`docs/multijugador-contrato.md`](docs/multijugador-contrato.md). Leelo cuando llegues
> a esta parte.

---

## Paso 5 · Apuestas / escrow (opcional)

Dos o más jugadores apuestan sats; Luna Negra **custodia el pozo** (escrow) y le paga al
ganador (menos un fee configurable). Acá tu **servidor de juego** es quien crea las
apuestas y reporta el resultado, así que necesitás una **API key**:

> La API key se crea en el panel **/provider → "Claves de API"** y **se muestra una sola
> vez** (guardala bien, no se puede volver a ver). Va siempre en el servidor.

**Crear una apuesta:**

```ts
const bet = await luna.createBet({
  gameId: "…",
  participants: ["npub1…", "npub1…"],   // ≥2, deben ser usuarios de Luna Negra
  stakeSats: 10,                         // cuánto pone cada uno
  victoryCondition: "primero en llegar a 100",
});
// Te devuelve: bet.betId, bet.contractEventId (el contrato firmado en Nostr) y
// bet.depositDeadline (hasta cuándo tienen para depositar).
```
Equivalente HTTP: `POST /api/v1/bets` con `Authorization: Bearer ln_sk_…`.

> **Reintentos seguros (idempotencia):** si tu pedido falla por red, no sabés si la
> apuesta se creó o no. Para reintentar sin riesgo de crear dos, mandá una cabecera
> `Idempotency-Key: <algo único>`. Reintentar con la **misma** key devuelve la respuesta
> original **sin crear otra apuesta**.

**Reportar el resultado** — acá tu firma Nostr actúa como "oráculo" (la prueba de quién
ganó la pone tu servidor, firmando con su clave Nostr):

```ts
const evt = luna.buildResultEvent(bet.betId, ["npub1ganador…"]);
const signed = finalizeEvent(evt, miClaveNostr);   // lo firmás vos con nostr-tools
await luna.reportResult(bet.betId, signed);
```
Equivalente HTTP: `POST /api/v1/bets/{betId}/result` con `{ "event": <firmado> }`.

> 🔒 **Por qué podés confiar en esto:** al crear la apuesta, el contrato (stake, fee,
> participantes) se **publica firmado en Nostr**. Antes de pagar, Luna Negra vuelve a
> calcular el hash del contrato y lo compara con el firmado: si alguien alteró los
> términos en el medio (`CONTRACT_MISMATCH`), **no paga**. Nadie puede cambiar las
> reglas después de apostar.

---

## Paso 6 · Webhooks

Configurá una **URL de webhook** en /provider. A partir de ahí, Luna Negra le hace un
`POST` con JSON a esa URL (con reintentos si tu servidor no responde) cada vez que pasa
algo:

| Evento | Cuándo |
|---|---|
| `purchase.completed` | un jugador compró tu juego |
| `bet.settled` | una apuesta se resolvió y se pagó |
| `payout.sent` | te enviamos tu parte |

Cada request trae dos cabeceras importantes: `X-LunaNegra-Event` (qué tipo de evento es)
y `X-LunaNegra-Signature` (la **firma HMAC-SHA256** del cuerpo, calculada con tu
secreto). **Siempre verificá la firma** antes de confiar en el contenido:

```ts
import { verifyWebhook } from "@lunanegra/sdk";

// OJO: necesitás el cuerpo CRUDO (el texto tal cual llegó, sin pasar por JSON.parse).
// La firma se calcula sobre esos bytes exactos; si lo parseás antes, no coincide.
if (!verifyWebhook(rawBody, req.headers["x-lunanegra-signature"], secret)) {
  return res.status(401).end();   // firma inválida → no es Luna Negra, rechazá
}
const { id, type, data } = JSON.parse(rawBody);
// type: "purchase.completed" | "bet.settled" | "payout.sent"
```

> Detalle típico que confunde a los principiantes: muchos frameworks (Express, etc.)
> parsean el JSON automáticamente. Para webhooks necesitás el **body crudo**, así que
> tenés que configurar la ruta para que no lo parsee antes de verificar la firma.

---

## Paso 7 · Feed de actividad (opcional)

Para que tus novedades aparezcan en la pestaña **Actividad** de tu juego, publicás una
nota de Nostr (un evento `kind:1`, que es una nota de texto) con este tag:

```
["t", "lunanegra:game:<slug>"]
```

Tanto vos como los jugadores pueden postear ahí. (Un "tag" en Nostr es una etiqueta que
sirve para agrupar/filtrar eventos; acá agrupa todo lo relacionado a tu juego.)

---

## Referencia rápida de endpoints

| Método | Endpoint | Auth | Para |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | — | Obtener la clave pública para validar tokens offline |
| GET | `/api/v1/entitlements/verify` | Bearer (entitlement) | Confirmar compra |
| GET | `/api/v1/rooms/verify` | Bearer (invite) | Validar quién se une a una sala (identidad + host) |
| GET | `/api/v1/players/{npub}/profile` | — | Refrescar el nombre/avatar de un jugador |
| POST | `/api/v1/bets` | Bearer (API key) | Crear apuesta |
| POST | `/api/v1/bets/{betId}/result` | Evento Nostr firmado | Reportar ganador |

## Checklist de integración

Empezá por lo mínimo (Pasos 1–3) y agregá lo demás cuando lo necesites:

- [ ] Publicaste tu juego en /provider (con tu Lightning Address).
- [ ] En tu juego, leés `?lnToken=` de la URL y **verificás el acceso en tu backend**
      (offline con JWKS, o por endpoint si recién empezás).
- [ ] (Multijugador) tu lobby valida el `inviteToken` con `verifyRoom`.
- [ ] (Apuestas) creaste una API key y usás `createBet` / `reportResult`.
- [ ] Configuraste un webhook y **verificás su firma HMAC** sobre el body crudo.

---

## ¿Y ahora qué?

- Cuando ya entendiste los conceptos, usá [`DEVELOPERS.md`](DEVELOPERS.md) como
  referencia rápida del día a día (es lo mismo, sin las explicaciones).
- Mirá el [ejemplo funcionando](public/demo-game/index.html) para ver todo junto.
- Si algo no te cierra, la referencia interactiva en `/developers` te deja probar los
  endpoints en vivo.
