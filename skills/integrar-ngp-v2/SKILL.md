---
name: integrar-ngp-v2
description: >-
  Integra juegos con Nostr Games Protocol (NGP) v2: login
  NIP-07/NIP-46, coordenada gameCoord, presencia NIP-38, marcador kind:31337,
  retos e invitaciones NIP-17, salas NIP-29 de diseño, reseñas/logros kind:1,
  zaps NIP-57, apuestas v2 por zaps con escrow custodial bajo /api/v2/bets y
  patrones probados en Tetris para signers, relays, inbox NIP-17 y auto-firma de
  depósitos. Usar cuando el usuario pida eventos Nostr nativos,
  resiliencia/interoperabilidad Nostr, retos 1v1, presencia Nostr, leaderboard
  Nostr, integración NGP, zaps o escrow por zap. Para acceso pago, webhooks y
  REST productivo usar integrar-luna-negra-1-0.
---

# Integrar juegos con Nostr Games Protocol (NGP)

Nostr Games Protocol (NGP) usa eventos Nostr firmados por el jugador o el juego para la
capa social: presencia, marcadores, retos, reseñas, logros, zaps y apuestas v2
por zaps. Es experimental y algunos `kind` propuestos pueden cambiar.

NGP no reemplaza la 1.0 para acceso pago, webhooks o escrow REST v1. Para
eso usa la skill `integrar-luna-negra-1-0`. La excepción en esta skill es
**apuestas v2 por zaps**: usa zaps NIP-57 públicos, pero sigue siendo custodial
y server-to-server con Luna Negra.

## Cuándo usarla

Usa esta skill si el usuario pide explícitamente alguno de estos objetivos:

- Login Nostr nativo con NIP-07 o NIP-46.
- Presencia "jugando X" publicada como NIP-38.
- Marcador firmado por el jugador con `kind:31337`.
- Retos o invitaciones 1v1 con NIP-17.
- Reseñas, comentarios o logros anclados al juego.
- Zaps NIP-57 al dev, al ganador o al juego.
- Apuestas v2 por zaps con `/api/v2/bets`.
- Interoperabilidad NGP con clientes Nostr sin depender solo de Luna Negra.

Si el usuario pide "integrar mi juego con Luna Negra" sin nombrar NGP, usa la
1.0 estable. Si quiere apuestas por zaps, usa esta skill; si quiere escrow REST
v1 o acceso pago, usa la 1.0.

## Prerrequisitos

Necesitas:

- Un signer Nostr del jugador: `window.nostr` (NIP-07), bunker NIP-46 o clave
  local si el juego la administra.
- La pubkey hex del jugador.
- `gameCoord`, la coordenada del juego: `30023:<pubkeyDeLaTienda>:<slug>`.
- Relays de escritura y lectura medidos; separa relays read-only de relays que
  aceptan publicaciones.

Puedes obtener `gameCoord` de `GET __LUNA_NEGRA_BASE__/api/v1/session` cuando el
juego se abrió con 1.0, o consultando el `kind:30023` real en relays:

```ts
{ kinds: [30023], "#d": ["<slug>"] }
```

No inventes `gameCoord`. El `slug` no siempre coincide con el nombre visible.

## Capacidades

| Capacidad | 1.0 REST | NGP | Estado |
|---|---|---|---|
| Identidad | `lnToken` SSO | NIP-07/NIP-46 | disponible |
| Marcador | `/api/v1/leaderboards` | `kind:31337` | implementado |
| Presencia | `/api/v1/presence` | NIP-38 `kind:30315` | implementado |
| Salas/estado | `/api/v1/rooms` | NIP-29 + jugadas | diseño |
| Invitación/reto | `/api/v1/invites` | NIP-17 gift-wrap | reto 1v1 implementado |
| Reseñas/logros | lectura en tienda | `kind:1` con `a=gameCoord` | implementado |
| Propinas/premios | pagos 1.0 | zaps NIP-57 | implementado |
| Apuestas v2 por zaps | `/api/v2/bets` | zaps NIP-57 públicos + escrow Luna | experimental |
| Marcador verificado | server/oráculo 1.0 | `kind:31338` | diseño |

## Patrón probado en Tetris

Organiza la integración en módulos pequeños:

- `nostrSigner`: signer activo singleton, restore desde storage, NIP-07/NIP-46/local.
- `nostrRelays`: `SimplePool` singleton y listas de relays por función.
- `nostrLogin`: deriva `pubkey`/`npub`, perfil best-effort y recién entonces persiste signer.
- `nostrPresence`: construir/publicar/limpiar NIP-38.
- `nostrLeaderboard`: construir/publicar `kind:31337`.
- `nostrChallenge` + `nostrChallengeInbox`: armar, publicar, parsear y deduplicar NIP-17.
- `lunaNegraBets`: server-side para `/api/v2/bets`, callbacks LNURL-pay y resultado.

Orden de bootstrap recomendado:

1. Restaurar signer guardado; para NIP-07, esperar hasta 3 s a que aparezca
   `window.nostr`.
2. Obtener pubkey, derivar `npub`, cargar perfil Nostr best-effort.
3. Activar presencia NIP-38 y el inbox NIP-17 solo cuando hay signer activo.
4. En logout, parar inbox y publicar presencia vacía con expiración inmediata.
5. En apuestas, mantener el resultado y la creación/resolución en backend; el
   browser solo firma el `kind:9734` de depósito y, opcionalmente, el comentario.

Relays:

```ts
const PROFILE_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol", "wss://relay.primal.net"];
const DM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social"];
const PUBLIC_WRITE_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
```

No publiques a `relay.nostr.band`; úsalo para lectura/indexación, no escritura.

## Identidad Nostr

Para NIP-07:

```ts
async function getNostrIdentity() {
  if (!window.nostr) throw new Error("No hay signer NIP-07");
  const pubkey = await window.nostr.getPublicKey();
  return { pubkey };
}
```

Al restaurar sesión, espera la inyección de `window.nostr`; algunas extensiones
la agregan después de cargar la página.

```ts
async function waitForNostr(timeoutMs = 3000) {
  const started = Date.now();
  while (!window.nostr && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.nostr ?? null;
}
```

Con bunker NIP-46, evita firmar en cada heartbeat: cada firma puede disparar un
prompt al usuario.

Persiste el método de signer, no solo la identidad. Para clave local puedes guardar
`nsec`; para NIP-46 guarda client secret + bunker; para NIP-07 guarda solo
`{ method:"nip07" }` y restaura cuando la extensión exista. Envuelve el signer en
un único punto para disparar un aviso antes de cada `signEvent`; así presencia,
score, retos y depósito muestran qué se firma.

## Marcador `kind:31337`

El jugador firma su mejor puntaje y lo publica a relays. Luna Negra puede
proyectarlo al mismo ranking que el camino REST, pero el evento también lo puede
leer cualquier cliente Nostr.

```ts
import { SimplePool } from "nostr-tools";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const board = "clasico";

const evt = await window.nostr.signEvent({
  kind: 31337,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", gameCoord],
    ["d", `${gameCoord}:${board}`],
    ["board", board],
    ["score", String(puntaje)],
    ["client", "tu-juego"],
  ],
  content: "",
});

await Promise.any(new SimplePool().publish(RELAYS, evt));
```

Reglas:

- `a` debe ser el `gameCoord` real.
- `kind:31337` es addressable.
- `d` debe ser `<gameCoord>:<board>`, para un récord por jugador y tablero.
- `board` debe matchear `^[a-z0-9][a-z0-9_-]{0,63}$`.
- `score` debe ser entero, no negativo y preferentemente clampeado a `1_000_000_000`.
- Usa el mismo nombre y unidades que el tablero REST si quieres fusionarlos.
- El puntaje firmado por cliente es falsificable; no lo uses para repartir dinero.
- Construye una función `buildScoreEvent()` que solo firma y otra `publishScore()`
  best-effort. Testea `kind`, `pubkey`, `a`, `d`, `board`, `score` y `verifyEvent`.

Para leer sin Luna Negra:

```ts
{ kinds: [31337], "#a": [gameCoord], "#board": [board] }
```

Agrupa por `pubkey` y quédate con el mejor `score`.

## Presencia NIP-38

El propio jugador firma el estado. No hace falta game server.

```jsonc
{
  "kind": 30315,
  "tags": [
    ["d", "general"],
    ["a", "30023:<tienda>:<slug>"],
    ["expiration", "<unix + 60-240s>"]
  ],
  "content": "Jugando Pac-Toshi"
}
```

El `content` va sin prefijo ni emoji si Luna Negra ya lo decora. Re-firma solo si
cambió el estado o pasaron unos 2 minutos. El `expiration` debe ser mayor que tu
intervalo de heartbeat para evitar titileo.

Patrón Tetris:

- TTL de presencia de unos 240 s para no disparar firmas frecuentes con NIP-46.
- `d="general"` para que el estado sea reemplazable.
- `content` `"Jugando <juego>"` para `in-game` y otro texto corto para `online`.
- Publicación best-effort con `Promise.any(pool.publish(PUBLIC_WRITE_RELAYS, evt))`.
- Limpieza en logout: firmar `kind:30315` con `content:""` y
  `["expiration", "<now+1>"]` para que desaparezca sin esperar TTL.

## Retos e invitaciones NIP-17

En NGP la invitación es un reto cifrado E2E. El server no puede leerlo. El rumor
interno es `kind:14` y viaja como gift-wrap `kind:1059`.

```jsonc
{
  "kind": 14,
  "pubkey": "<retador>",
  "tags": [
    ["p", "<invitado>"],
    ["game", "30023:<tienda>:<slug>"],
    ["url", "https://tu-juego.com/?room=..."],
    ["expiration", "<unix>"]
  ],
  "content": "Te reto a una partida"
}
```

Para 1v1 puro omite `room`. Si usas sala NIP-29, agrega:

```jsonc
["room", "<groupId>", "wss://relay..."]
```

Requisitos:

- Signer con NIP-44 para cifrado moderno.
- Publicar el gift-wrap en la bandeja NIP-17 del destinatario.
- Resolver relays de DM con una sola función compartida por emisor y receptor.
- Al recibir, desenvolver `kind:1059` -> seal `kind:13` -> rumor `kind:14`.
- Verificar `rumor.pubkey === seal.pubkey` para evitar suplantación.

La causa más común de "reto enviado pero no llega" es publicar en un set de relays
y escuchar en otro. Usa fallback de DM unido a los `kind:10050` del destinatario.

Patrón Tetris para no depender de la clave privada cruda:

1. Crear un rumor `kind:14` sin firma, con tags `p`, `game`, `url`,
   `expiration` y, si aplica, `room`. Calcular `id` con `getEventHash`.
2. Cifrar el rumor con NIP-44 hacia el destinatario y firmar un seal `kind:13`
   con el signer del emisor.
3. Cifrar el seal con una clave efímera hacia el destinatario y firmar el
   gift-wrap `kind:1059` con esa clave efímera.
4. Crear también una auto-copia del gift-wrap dirigida al emisor para que el reto
   aparezca en su propio historial.
5. Usar timestamps aleatorizados hasta 2 días hacia atrás en seal/gift-wrap
   (NIP-59). Por eso el inbox debe suscribirse con lookback de ~3 días, no
   `since: now()`.
6. Al parsear, rechazar si expiró, si `game` no coincide, si la URL no es del
   mismo origin, o si `rumor.pubkey !== seal.pubkey`.
7. Deduplicar por `giftWrap.id` y por `rumor.id`, y persistir ids vistos acotados
   en storage para no repetir toasts al recargar.

## Salas NIP-29

Esto es diseño, no contrato estable. Para juegos por turnos determinísticos:

- La sala es un grupo NIP-29 en un relay group-aware.
- Cada jugada es un evento firmado, por ejemplo `kind:9421` propuesto.
- Tags esperados: `h=<groupId>`, `a=<gameCoord>`, `seq`, `prev`.
- El estado se reconstruye plegando jugadas.

No uses este diseño para tiempo real exigente, información oculta, azar no
verificable o dinero. Usa 1.0 salas REST o un árbitro de backend.

## Reseñas, comentarios y logros

Publica un `kind:1` con tag `a=gameCoord`.

```jsonc
{
  "kind": 1,
  "tags": [["a", "30023:<tienda>:<slug>"]],
  "content": "Gran juego, nuevo logro desbloqueado"
}
```

Luna Negra ya puede leerlos y mostrarlos en la ficha del juego. No necesitas
construir UI de lectura salvo que el juego quiera mostrarlos dentro.

## Zaps NIP-57

Usa zaps para propinas o premios sin escrow: al dev, al ganador o a un evento del
juego. Los recibos `kind:9735` verificados alimentan rankings de zappers.

No mezcles zaps libres con apuestas custodiadas: si hay depósito, pozo y payout
usa el flujo de apuestas v2 por zaps de esta skill.

## Apuestas v2 por zaps

Aunque use zaps NIP-57 públicos, este flujo sigue siendo escrow custodial de
Luna Negra y server-to-server. Lo que cambia respecto a la apuesta REST v1 es el
riel: depósitos, premio, corte de la casa y corte del dev quedan auditables como
zaps en relays. Puede estar apagado por deploy (`BETS_V2_ENABLED`).

Mismo flujo de creación/resolución que la 1.0, pero bajo `/api/v2/bets`:

```ts
POST /api/v2/bets
GET  /api/v2/bets/{id}
POST /api/v2/bets/{id}/result
POST /api/v2/bets/{id}/cancel
```

La diferencia está en el depósito: lo paga el jugador firmando un zap request
NIP-57.

- Sin construir UI: manda al jugador a
  `__LUNA_NEGRA_BASE__/apuestas/{betId}` para firmar el zap, pagar y ver estado.
- UI propia (patrón Tetris): `GET /api/v2/bets/{id}` trae, por participante, un
  `depositZapRequest` (`kind:9734` sin firmar) + su `depositCallback` LNURL-pay. El
  browser firma el 9734 y tu backend hace
  `GET depositCallback?amount=<stakeSats*1000>&nostr=<9734-firmado>`; el `pr` que
  devuelve es el invoice a pagar.
- Después pollea `GET /api/v2/bets/{id}` hasta que el depósito del participante
  quede pagado.

El resultado sigue viniendo del game server con API key, no del marcador cliente:

```ts
POST /api/v2/bets/{id}/result { "winners": ["npub1..."] }
```

Si el jugador también firma un comentario de participación `kind:1`, el premio
puede zapearse a ese comentario para que quede como zap recibido en su perfil. El
depósito funciona igual sin ese comentario.

Patrón Tetris para UI propia:

- Validar la forma mínima de `depositZapRequest`: `kind`, `created_at`, `content`
  y `tags: string[][]`. Si falta, caer a `payUrl`/`/apuestas/{betId}`.
- Antes de firmar, comprobar que `signer.getPublicKey()` coincide con la pubkey de
  la sesión Nostr del participante. Luna rechazará un 9734 firmado por otra clave.
- No re-firmar si el participante ya tiene `bolt11`; ese invoice ya compromete el
  zap request vía description hash.
- Firmar `participationComment` con la misma identidad, pero tratarlo best-effort:
  si falla, el depósito sigue y el premio cae al contrato.
- Enviar `signedZapRequest` y `signedComment` al backend propio; el backend reenvía
  el 9734 al `depositCallback` LNURL-pay con `?amount=<stakeMsat>&nostr=<json>`.
- El callback LNURL puede devolver `200` con error LNURL; el éxito real es que
  exista `pr`.
- Persistir el `bolt11` localmente al recibirlo para que el QR sobreviva al polling.
- Durante polls/refrescos, conservar `bolt11` o `depositZapRequest` +
  `depositCallback` del estado previo si el depósito sigue `pending`; evita que la
  UI parpadee al fallback.
- Auto-firma opcional: si llega `depositZapRequest` + `depositCallback`, hay signer
  activo/restaurable y el depósito está pending, dispara la firma una sola vez por
  `betId` con un guard anti-concurrencia. Deja botón manual como fallback.
- Si Luna devuelve `BETS_V2_DISABLED`, mostrar un error explícito; si devuelve
  `ANCHOR_PUBLISH_FAILED`, sugerir reintentar.

## Marcador verificado `kind:31338`

Esto es diseño. Para rankings con dinero, un oráculo co-firma una atestación que
referencia el score del jugador.

Tags propuestos:

```jsonc
[
  ["a", "30023:<tienda>:<slug>"],
  ["e", "<scoreEventId>"],
  ["p", "<jugador>"],
  ["status", "verified"]
]
```

Mantén dos tiers: abierto (`kind:31337`, social, falsificable) y verificado
(`kind:31338`, oráculo, apto para stakes cuando se conecta con escrow 1.0).

## Gotchas

1. `gameCoord` real no es placeholder. Si el `a` tag no coincide, Luna filtra por
   coord y no encuentra eventos.
2. No publiques a relays de solo lectura. Mantén relays de escritura separados.
3. Cada presencia NIP-38 es una firma. Throttlea con NIP-46.
4. No dupliques emoji/prefijo en `content` de presencia.
5. Para contactos y perfiles a escala, usa modelo outbox: lee `kind:3` y
   `kind:10002` desde relays de escritura del usuario, y trae `kind:0` por lotes.
6. La tienda debe aceptar eventos por `a=gameCoord`; no exigir tags privadas de
   Luna Negra.
7. `board` y unidades del `kind:31337` deben coincidir con REST si se fusionan.
8. NIP-17 requiere publicar y escuchar en el mismo set de relays, incluidos
   `kind:10050`. Algunos relays exigen NIP-42 AUTH.
9. `window.nostr` puede aparecer de forma asincrónica. Sondea antes de rendirte.
10. NIP-17 (`kind:1059`) y NIP-04 (`kind:4`) son bandejas distintas. Un chat que
    solo lee NIP-04 no ve retos NIP-17.
11. En apuestas v2, no borres handles de depósito por un poll incompleto. Conserva
    `bolt11` o `depositZapRequest` + `depositCallback` mientras el depósito siga
    pendiente.
12. En serverless, si el entrypoint de la función importa lógica transitiva, puede
    quedar cacheado. Expón una ruta de versión/rev del handler si estás desplegando
    en una plataforma con build cache agresivo.

## Checklist

- [ ] Elegir signer: NIP-07, NIP-46 o clave local.
- [ ] Obtener `pubkey` del jugador.
- [ ] Obtener `gameCoord` real.
- [ ] Separar relays de escritura y lectura.
- [ ] Publicar y leer un evento round-trip con el mismo filtro `#a`.
- [ ] Throttlear presencia NIP-38.
- [ ] Mantener `board` consistente con ranking REST si aplica.
- [ ] Testear `kind:30315`, `kind:31337` y NIP-17 con `verifyEvent`/round-trip local.
- [ ] Para NIP-17, usar la misma `resolveDmRelays(pubkey)` en envío y recepción.
- [ ] Rechazar retos vencidos, de otro `gameCoord`, de otro origin o con
      `rumor.pubkey !== seal.pubkey`.
- [ ] Para apuestas v2 por zaps, usar `/api/v2/bets` y mantener el resultado en
      el game server.
- [ ] En depósitos v2, verificar signer contra sesión, no re-firmar si ya hay
      `bolt11` y conservar handles visibles durante polling.
- [ ] No usar NGP para acceso pago, webhooks o escrow REST v1.

## Referencias del repo

- Spec de Nostr Games Protocol (NGP): `docs/nostr-games-protocol.md`
- Salas e invitaciones NGP: `docs/nostr-games-protocol-salas-invitaciones.md`
- Implementación de NGP: `docs/nostr-games-protocol-implementacion.md`
