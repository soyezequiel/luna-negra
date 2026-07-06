# NGP — Apuestas y escrow por eventos

> ✅ **IMPLEMENTADO Y VALIDADO EN PRODUCCIÓN.** Extiende
> [nostr-games-protocol.md](nostr-games-protocol.md) (NGP) con la capa de
> apuestas. Fases 0–3 completas (§8); los `kind` 1339 / 1341 / 31340 están
> **congelados** (v1 estable).
>
> **Relación con lo existente.** Las apuestas v2 (`/api/v2/bets`) ya mueven el
> dinero por zaps NIP-57 públicos, pero la **coordinación** (crear, consultar
> estado, reportar resultado, cancelar) sigue siendo REST con API key. Este
> documento reemplaza esa coordinación por eventos Nostr. El código de v2
> (LNURL de depósito, ledger, comisiones, payouts, tick) se **reutiliza**: lo
> que cambia es el transporte. Ambos caminos conviven detrás de un flag.

---

## 0. La restricción honesta: custodio sí, pero transparente

**Nostr es mensajería firmada, no liquidación de dinero.** Retener un stake y
pagar al ganador exige un custodio (trustless real = DLCs sobre Bitcoin, fuera
de alcance). Eso no cambia acá.

Lo que sí cambia: Luna Negra pasa de "servidor con API propietaria" a
**escrow transparente** — un custodio cuyas acciones son todas eventos firmados,
públicos y verificables por cualquier cliente Nostr:

| Acción | Hoy (v2 REST) | NGP apuestas |
|---|---|---|
| Crear apuesta | `POST /api/v2/bets` + API key | el retador publica el **contrato** (kind:1339) |
| Aceptar términos | implícito al depositar vía REST | el zap request 9734 firmado que tagea el contrato **es** la aceptación |
| Consultar estado | polling `GET /api/v2/bets/{id}` | suscripción al **estado del escrow** (kind:31340) que publica Luna |
| Reportar resultado | `POST /result` + API key | el **oráculo** publica el resultado (kind:1341) firmado con su clave |
| Cancelar | `POST /cancel` + API key | kind:1341 con `status=void` |
| Depósitos y premios | zaps NIP-57 (ya público) | igual — recibos 9735 auditables |

El único HTTP que queda es el **callback LNURL-pay**, que es parte del estándar
NIP-57 (sin él no hay invoice Lightning). No es una API propietaria: cualquier
wallet/cliente que sepa zapear puede depositar.

**Qué gana el juego:** cero API key, cero backend obligatorio (salvo la clave
del oráculo), y la apuesta completa —contrato, depósitos, resultado, payouts—
queda legible y verificable en relays aunque Luna Negra desaparezca mañana.

**Qué NO garantiza:** que Luna pague. La garantía es **detectabilidad**, no
imposibilidad: si el escrow no paga o paga al perdedor, la cadena de eventos lo
prueba públicamente (ver §7). Es una garantía reputacional, no criptográfica.

---

## 1. Rangos de kind — por qué estos números

- **Contrato (1339) y resultado (1341)** son eventos **regulares**
  (rango 1000–9999): deben ser **inmutables**. Si vivieran en 30000–39999 los
  relays los tratarían como addressable y un segundo evento del mismo autor
  reemplazaría al primero — inaceptable para un contrato.
- **Estado del escrow (31340)** es **addressable** (`d` = id del contrato): es
  el único que *debe* ser reemplazable, porque representa el estado vigente.
- El `id` del evento de contrato **es** el hash de los términos: la integridad
  viene gratis del protocolo (mismo rol que `contractHash`/`CONTRACT_MISMATCH`
  en v1/v2, pero sin mecanismo propio).

---

## 2. El contrato — kind:1339 *(estable)*

Lo firma y publica el **retador** (un jugador, o el juego en su nombre). A
diferencia de v2 —donde el ancla la firma Luna Negra— acá el contrato existe y
es verificable **sin** Luna Negra.

```jsonc
{
  "kind": 1339,                          // (estable) regular, inmutable
  "pubkey": "<pubkey del retador>",
  "created_at": 1751760000,
  "tags": [
    ["a", "30023:npub1dev…:pacman-pwa"],           // GAME — coordenada NIP-23
    ["p", "<pubkey jugador 1>"],                    // sin marker = participante
    ["p", "<pubkey jugador 2>"],
    ["p", "<pubkey escrow>", "<relay>", "escrow"],  // quién custodia (Luna Negra)
    ["p", "<pubkey oráculo>", "<relay>", "oracle"], // quién puede declarar ganador
    ["stake", "1000"],                              // sats por asiento, entero
    ["deadline", "1751763600"],                     // unix: límite para fondear
    ["t", "ngp-bet"]                                // para filtrar/descubrir
  ],
  "content": "Apuesta 1v1 en Pac-Toshi, tablero clásico. Gana el mejor de 3."
}
```

### Reglas

- **`p` sin marker = participante** (un tag por asiento, en orden). Con marker
  `"escrow"` u `"oracle"` en la posición 4 (estilo NIP-10) declara roles. El
  retador puede ser también participante (lo normal en 1v1).
- **`stake`**: sats enteros por asiento, igual para todos. Dentro de los límites
  publicados por el escrow (§2.1).
- **`deadline`**: NO usar el tag `expiration` de NIP-40 — los relays pueden
  **borrar** el evento vencido, y el contrato debe sobrevivir como registro.
- **`oracle`**: la pubkey del oráculo del juego (el game server). El dev la
  declara además en su artículo 30023 (tag `["oracle", "<pubkey>"]`), así
  cualquiera puede verificar la cadena juego → oráculo → resultado sin
  preguntarle a Luna. Es la misma `Provider.oraclePubkey` que ya existe.
- **Asientos invitados**: NGP puro no tiene "guest seats" — todo asiento es una
  pubkey. Para invitados, el juego genera una clave efímera local y la usa como
  asiento. Quien necesite invitados administrados usa v2 REST.
- **Comentarios y zaps sociales** cuelgan del contrato con `e`=<id> y del juego
  con `a`=GAME, exactamente como hoy: nada que implementar.

### 2.1 Condiciones del escrow — publicadas, no negociadas

Las comisiones y límites no los fija el contrato: los fija el escrow y los
**publica** como evento addressable, para que el juego los lea antes de crear
el contrato (reemplaza el "leer la doc de la API"):

```jsonc
{
  "kind": 31340,
  "pubkey": "<pubkey escrow>",
  "tags": [
    ["d", "terms"],
    ["t", "ngp-bet"]
  ],
  "content": "{\"minStakeSats\":100,\"maxStakeSats\":100000,\"feePct\":2,\"devFeePct\":1,\"feeMinSats\":1,\"depositWindowSec\":3600,\"resolveWindowSec\":86400}"
}
```

El escrow **acepta o rechaza** cada contrato con su primer evento de estado
(§4). No hay negociación: si el stake está fuera de rango o el juego no está
registrado, publica `status=rejected` con el motivo y ahí termina.

---

## 3. Depósito = aceptación — NIP-57 estándar

No hace falta un evento de aceptación: el **zap request (kind:9734) firmado**
por cada participante es su firma sobre los términos. Flujo NIP-57 estándar:

1. El participante arma y firma un 9734 con `["e", "<id del contrato>"]`,
   `["p", "<pubkey escrow>"]` y `amount` = stake en msat.
2. Lo manda al callback LNURL-pay del escrow
   (`GET <callback>?amount=<msat>&nostr=<9734>` — el LNURL sale del kind:0 /
   lud16 del escrow, como cualquier zap).
3. Paga el invoice `pr` que devuelve.
4. El escrow publica el **recibo 9735**: prueba pública del depósito, con el
   9734 embebido (la firma del participante queda dentro del recibo).

El escrow valida antes de emitir invoice: la pubkey del 9734 es un asiento del
contrato, el monto es exactamente el stake, el contrato no venció ni fue
rechazado, y el asiento no está ya fondeado.

> **Anti-spam clave:** el escrow NO necesita reaccionar a cada kind:1339 que lo
> nombre. Puede ignorar contratos hasta que llega el **primer intento de
> depósito** (el callback LNURL trae el 9734 con el `e` del contrato → lo busca
> en relays on-demand, lo valida y recién ahí crea estado interno). Publicar
> contratos basura no le cuesta nada a nadie ni le genera trabajo al escrow;
> fondearlos cuesta sats.

Igual que en v2: si el participante además firma un **comentario de
participación** (kind:1111 NIP-22, con `E`/`e`=contrato y `K`/`k`=kind de la
raíz), el premio puede zapearse a ese comentario y queda como zap recibido en su
perfil. Opcional y best-effort. Se usa **kind:1111** (comentario NIP-22) en vez de
kind:1 a propósito: es el kind correcto para comentar un evento que no es una nota
(la raíz puede ser un kind:1 o el propio 1339) y, además, los clientes NO lo
listan en las pestañas "Notas"/"Respuestas" del perfil, así el perfil del
apostador no se llena de respuestas redundantes.

---

## 4. Estado del escrow — kind:31340 *(estable)*

Lo firma el **escrow**. Addressable con `d` = id del contrato: siempre hay un
único estado vigente, y cada transición queda firmada y con timestamp.
Reemplaza el polling de `GET /api/v2/bets/{id}` por una suscripción.

```jsonc
{
  "kind": 31340,
  "pubkey": "<pubkey escrow>",
  "tags": [
    ["d", "<id del contrato>"],
    ["e", "<id del contrato>"],            // navegable desde el contrato
    ["a", "30023:npub1dev…:pacman-pwa"],
    ["status", "funded"],                   // ver tabla
    ["t", "ngp-bet"]
  ],
  "content": "{\"deposits\":[{\"p\":\"<pubkey1>\",\"receipt\":\"<id 9735>\"},{\"p\":\"<pubkey2>\",\"receipt\":\"<id 9735>\"}],\"potSats\":2000,\"feePct\":2,\"devFeePct\":1}"
}
```

| `status` | Significado | Equivalente interno v2 |
|---|---|---|
| `accepted` | contrato validado, esperando depósitos | `pending_deposits` |
| `rejected` | el escrow no toma este contrato (motivo en content) | — |
| `funded` | todos los asientos depositaron; a jugar | `funded` |
| `resolved` | pagado; content referencia el 1341 y los 9735 de payout | `resolved` |
| `void` | anulada; depósitos reembolsados (recibos en content) | `voided` |
| `expired` | venció `deadline` sin fondear; depósitos parciales reembolsados | `expired_refunded` |

En `resolved`, el content referencia: el evento de resultado (`resultEvent`),
el recibo del premio (`payoutReceipt`), el corte del dev (`devFeeReceipt`) y el
corte de la casa retenido (`feeSats`). **Toda la liquidación queda enlazada
desde un solo evento.** El escrow puede además publicar la nota de liquidación
humana (kind:1, tag `t`=`lunanegra:settle:v2`) como hace v2 hoy — es social,
no normativa.

El juego se suscribe con:

```jsonc
{ "kinds": [31340], "#e": ["<id del contrato>"] }
```

---

## 5. El resultado — kind:1341 *(estable)*

Lo firma el **oráculo** declarado en el contrato. Regular e inmutable.
Reemplaza `POST /result` + API key: la autenticación ES la firma.

```jsonc
{
  "kind": 1341,                          // (estable) regular, inmutable
  "pubkey": "<pubkey del oráculo>",
  "tags": [
    ["e", "<id del contrato>"],
    ["a", "30023:npub1dev…:pacman-pwa"],
    ["p", "<pubkey ganador>"],            // 0..N ganadores
    ["status", "win"],                    // win | draw | void
    ["t", "ngp-bet"]
  ],
  "content": "{\"score\":\"3-1\"}"        // opcional, metadata libre
}
```

- **`win`** + 1..N `p` = reparto del pozo entre ganadores (menos comisiones).
- **`draw`** = empate: el pozo vuelve a los participantes por partes iguales.
- **`void`** = anulación: reembolso íntegro (política de comisión del escrow).
  También puede firmarlo el **retador** mientras el estado sea `accepted`
  (nadie fondeó todavía o solo él) — equivale al `cancel` de v2.

El escrow, antes de pagar, verifica: firma válida, `pubkey` == oráculo del
contrato (y == oráculo registrado del juego), `e` == contrato en estado
`funded`, ganadores ⊆ participantes, y que no exista ya un 1341 procesado para
ese contrato (**el primero válido gana**; los siguientes se ignoran — mismo
criterio idempotente de v2).

Si venció la ventana de resolución sin 1341 (el oráculo se murió), el tick del
escrow anula y reembolsa, publicando `status=void` en el 31340 con el motivo.
Los reembolsos van a la cascada de destino de cada participante (lud16 del
perfil, etc.) — misma `resolveDestination` de hoy.

### La clave del oráculo: gestionada o propia (BYO)

El 1341 se valida contra `Provider.oraclePubkey`. Hay **dos modos de custodia** de
esa clave (`src/lib/oracle-keys.ts`):

- **Gestionada (default).** Luna genera y custodia el par. El juego reporta con su
  **API key** (`POST /api/v2/bets/{id}/result { winners }`) y Luna firma el 1341 por
  él. Cero fricción de claves, pero no es keyless: Luna es un tercero de confianza
  para firmar.
- **Propia / BYO (keyless — Slice 2).** El proveedor trae **su propia** clave Nostr
  de oráculo. Luna solo guarda la pubkey (`oracleSecretEnc = null`,
  `oracleSelfSigned = true`) y **no puede firmar por él**: el juego firma sus 1341
  con su clave y (a) los **publica en relays** — los levanta `ngp-bet-result-sync` —
  o (b) los postea a `/result` como `{ event }` (la firma ES la auth, sin API key).
  Los caminos gestionados (`/result` con API key, `/activity`) responden
  `SELF_SIGNED_ORACLE` en este modo.

**Declarar la clave propia** (self-serve, prueba de posesión): el dueño del
proveedor pide el reto con `GET /api/provider/oracle/self` → `{ challenge }`, firma
un evento cuyo `content` es exactamente ese `challenge` (con `created_at` reciente)
usando su clave de oráculo, y lo envía con `POST /api/provider/oracle/self
{ proof }`. Luna verifica firma + reto ligado al `providerId` + frescura y guarda la
pubkey. `POST /api/provider/oracle/managed` vuelve al modo gestionado (genera par
nuevo). `GET /api/v2/bets/ngp-config` devuelve `oracleSelfSigned` para que el juego
sepa si debe auto-firmar. El oráculo declarado en el 1339 debe ser esta pubkey (la
ingesta lo valida con `ORACLE_MISMATCH`).

### Relación con el marcador

El kind:31337 (score firmado por el jugador) sigue siendo **social y
falsificable** — nunca dispara pagos. El 1341 es la pieza "con dinero", y es
coherente con la atestación 31338: el oráculo puede publicar ambos (31338
atestigua el score, 1341 declara el ganador del contrato).

---

## 6. Payouts — zaps, como v2

Sin cambios respecto de v2, que ya es auditable:

- **Premio**: zap del escrow al ganador — al kind:1 de participación si existe
  (aparece en su perfil), si no profile-zap. Recibo 9735 público.
- **Corte del dev**: zap a la Lightning Address del proveedor. Recibo 9735.
- **Corte de la casa**: se retiene en el pozo (no hay movimiento saliente);
  queda declarado en el content del 31340 `resolved`.

---

## 7. Verificación por terceros — la cadena completa

Cualquier cliente Nostr, sin tocar a Luna Negra, puede reconstruir y auditar
una apuesta:

1. **Contrato** (1339): firmado por el retador; su `id` fija los términos.
2. **Oráculo legítimo**: el tag `oracle` del contrato coincide con el `oracle`
   del artículo 30023 del juego.
3. **Depósitos**: recibos 9735 del escrow con `e`=contrato; cada uno embebe el
   9734 firmado por el participante (su aceptación). *(Nota: el 9735 lo firma
   el escrow — la prueba del pago Lightning en sí es off-chain, como en todo
   zap.)*
4. **Estado**: transiciones 31340 firmadas y con timestamp.
5. **Resultado**: 1341 firmado por el oráculo declarado.
6. **Payouts**: 9735 del premio y del corte del dev; los montos deben cuadrar
   con stake × asientos − comisiones publicadas en `terms`.

Si el escrow paga a quien el 1341 no declaró, no paga, o los montos no cuadran,
**cualquiera puede probarlo** con eventos firmados. Eso es lo máximo que da un
custodio: mala conducta detectable e imputable, no imposible.

### Amenazas consideradas

| Amenaza | Mitigación |
|---|---|
| Alterar términos post-firma | imposible: el `id` del 1339 es el hash |
| Resultado falso | solo vale la firma del oráculo declarado; el score 31337 del cliente nunca paga |
| Clave del oráculo comprometida | mismo riesgo que la API key hoy; rotación en el panel del proveedor (el 30023 se re-publica con la nueva) |
| Replay de un 1341 en otro contrato | el tag `e` lo ata a un contrato único |
| Reuso de un 9734 viejo | el invoice compromete el 9734 vía description hash (NIP-57); un 9734 no pagado no es nada |
| Spam de contratos | el escrow no hace nada hasta el primer intento de depósito (§3) |
| Doble 1341 contradictorio | el primero válido procesado gana; idempotente |
| Relay censura/pierde eventos | publicar a varios relays + el relay propio del escrow; el camino de depósito (LNURL) garantiza que el escrow vea todo contrato que alguien intenta fondear |

---

## 8. Plan de implementación por fases

Cada fase sirve sola y no rompe nada. `/api/v2/bets` sigue vivo siempre
(webhooks, invitados administrados, server-to-server); NGP es una puerta de
entrada más al **mismo** motor: `zapBet`, ledger, `escrow-v2-settle`, LNURL de
depósito, tick — todo se reutiliza.

**Fase 0 — Sombra (sin cambio de contrato público). ✅ implementada.**
Luna publica el evento `terms` (§2.1) y empieza a publicar 31340 para las
apuestas v2 **existentes** (hook en cada transición de estado: creación,
depósito confirmado, settle, void, expire). Doble escritura: REST sigue siendo
la fuente. Resultado: el estado de toda apuesta v2 ya es observable por Nostr,
gratis, y se valida el esquema en producción.
*Código: `src/lib/ngp-bet-state.ts` (+ hooks en la creación v2, `zap-bet.ts`,
`escrow-v2-settle.ts`, `escrow-v2-tick.ts`, cancel y `zap-bet-sync.ts`, que
re-publica el estado terminal cuando llega el recibo del payout). Terms se
pre-publican al boot (`instrumentation.node.ts`). Flag `NGP_BETS_ENABLED`
(default ON, `"false"` lo apaga).*

**Fase 1 — Resultado por evento. ✅ implementada.**
Watcher in-process (mismo patrón que `score-sync`/`zap-sync`: `setInterval` en
instrumentation): levanta `{kinds:[1341], "#t":["ngp-bet"]}`, valida (firma ==
oráculo del proveedor, `e` == ancla conocida, ganadores ⊆ participantes) y
liquida con el MISMO núcleo que `/api/v2/bets/{id}/result`
(`settleZapBetWithResult`). El juego ya puede reportar resultados sin API key.
*Código: `src/lib/ngp-bet-result-sync.ts` (cadencia
`NGP_BET_RESULT_SYNC_INTERVAL_MS`, default 30 s).*

**Fase 2 — Contrato por evento. ✅ implementada.**
El callback LNURL de la tienda (`/.well-known/lnurlp/luna`), al recibir un 9734
cuyo `e` no corresponde a ninguna apuesta conocida, busca el 1339 en relays por
id, lo valida (firma; `t`=`ngp-bet`; el `p` con rol `escrow` == pubkey de la
tienda; el `p` con rol `oracle` == `Provider.oraclePubkey` del juego; `a` =
coordenada de un juego publicado; stake dentro de las `terms`; `deadline` no
vencido; el firmante del depósito es participante) y crea la `zapBet` con
`anchorEventId` = **id del 1339** (firmado por el retador, ya no por Luna).
Las comisiones se resuelven server-side igual que `createZapBet` (el retador
acepta las condiciones publicadas, no las negocia). De ahí en más el depósito
sigue el flujo v2 idéntico. El intento de fondeo es la única señal que despierta
al escrow (anti-spam §3). Concurrencia resuelta por el `@unique` de
`anchorEventId` (P2002 → re-leer). Flag `NGP_BETS_ENABLED`.
*Código: `src/lib/ngp-bet-ingest.ts` (`materializeNgpBet`), enganchado en
`src/app/.well-known/lnurlp/luna/route.ts` con rate-limit por pubkey del
firmante.*

**Materialización EAGER (para juegos con backend).** Un juego que orquesta la
apuesta server-side (p. ej. una sala) no espera al primer depósito: publica el
1339 y llama con su API key a **`POST /api/v2/bets/from-contract`**
`{ contractEventId }`, que corre el mismo `materializeNgpBet` (autorizado por
dueño del juego en vez de por firmante del depósito) y devuelve el **mismo shape
que `POST /api/v2/bets`** (betId + handles de asiento). Así el juego reusa todo
su flujo v2 de depósito/resultado sin cambios: los handles de depósito ya usan
`bet.anchorEventId` como `e`, que ahora es el id del 1339. Para armar el contrato
el juego lee **`GET /api/v2/bets/ngp-config?gameId=`** (API key) →
`{ storePubkey, oraclePubkey, gameCoord, minStakeSats, maxStakeSats }`.
*Código: `src/app/api/v2/bets/{from-contract,ngp-config}/route.ts` +
`src/lib/escrow-v2-serialize.ts`.*

**✅ Validado en producción (6 jul 2026).** Una apuesta real de tetris-beta corrió
entera por NGP: contrato `kind:1339` firmado por la clave de servicio del juego,
materializado por `from-contract` (el `31340` de la apuesta ancla en el id del
1339, no en un `kind:1` de Luna), depósitos y premio por zaps, `status: resolved`.
El resultado siguió por API key (Slice 1). **Slice 2 (resultado keyless) ✅
implementado**: el proveedor puede declarar su propia clave de oráculo (BYO) y
firmar sus 1341 sin API key (ver "La clave del oráculo" en §5). Falta que el juego
de referencia (Tetris) lo adopte end-to-end.

**Integración de referencia — Tetris.** `createBetForRoom` publica el 1339 con
una **clave de servicio del juego** (`LUNA_NEGRA_NGP_NSEC`) y materializa por
`from-contract`; el resto (depósito por zap, refresh, resultado por API key,
cancel) queda igual. Gateado por `LUNA_NEGRA_NGP_BETS=1` y **solo cuando todos
los jugadores tienen npub** (los pozos con invitados sin clave caen al camino
custodial legacy). El resultado sigue por `POST /result` con API key (Slice 1):
Luna liquida con el oráculo gestionado y publica el `31340 resolved`. Para pasar a
resultado **keyless** (Slice 2, ya soportado por Luna), Tetris tendría que declarar
su clave de oráculo BYO (`POST /api/provider/oracle/self`) y firmar sus 1341 con
ella en vez de llamar a `/result`. *Código: `src/online/lunaNegraNgp.ts` + branch en
`src/online/lunaNegraBets.ts` (repo Tetris).*

> **Nota de transporte.** El depósito NGP cae en el LNURL **de la tienda**
> (`luna@dominio`, descubierto del `kind:0`/lud16 del escrow), no en el
> per-participante `/api/v2/lnurlp/[pid]` (ese es solo del flujo v2 REST, que
> crea el participante antes). El mismo `validateDepositZapRequest` acepta ambos
> LNURL, así que no hubo que tocar la validación del zap.

> **Guest seats (claves efímeras).** La ingesta resuelve cada `p` participante a un
> `User` por pubkey (upsert: cuenta existente o mínima). No hay asientos "invitados"
> administrados por Luna como en v2: en NGP el juego que orquesta la sala **genera
> una clave Nostr efímera por invitado** (un `secp256k1` random en el server del
> juego), la usa como pubkey del asiento en el 1339 y **firma con ella** tanto el
> 9734 del depósito como el comentario de participación. Para Luna esos asientos son
> indistinguibles de un jugador con npub propio: la validación es la misma (el
> firmante del depósito debe ser uno de los `p` del contrato). Consecuencias para el
> dev: (1) el premio se paga a esa clave efímera, así que el juego debe custodiarla
> hasta cobrar (o rutear el payout a una LN address del invitado vía su perfil); (2)
> si el juego pierde la clave antes del payout, el premio cae al retiro por QR
> (`withdraw_pending`) y expira como forfeit; (3) la clave efímera **no** debe
> reusarse entre apuestas. Cuando *todos* los asientos tienen npub real, el juego usa
> las claves de los jugadores y no genera ninguna efímera (es el caso 1v1 típico).

**Fase 3 — Pulido. ✅ implementada.**
- **`status=void` del retador (cancel).** El autor del contrato (`bet.contractPubkey`,
  guardado en la ingesta) puede anular su apuesta **pre-fondeo** publicando un 1341
  `status=void`: `ngp-bet-result-sync` lo detecta, reembolsa lo depositado por zap y
  la deja `cancelled_admin` (proyecta a NGP `void`). Reusa el mismo núcleo que el
  cancel v2. Una vez `funded` ya no puede anular: manda el oráculo. *Código:
  `src/lib/ngp-bet-result-sync.ts` (`isChallengerVoid` + `cancelNgpBetPreFunding`),
  campo `ZapBet.contractPubkey`.*
- **Claves efímeras para invitados documentadas** (ver nota "Guest seats" arriba).
- **Kinds congelados** (ver apéndice): 1339 / 1341 / 31340 pasan de *propuesto* a
  *estable* tras la validación en producción.
- Pendiente menor: evidencia NGP en el panel de integración (contratos 1339 vistos
  por juego) y refresco de la skill `integrar-ngp-v2`.

### Qué implementa el dev de un juego (todo el flujo)

```
1. Leer terms del escrow        → 1 fetch a relays {kinds:[31340], "#d":["terms"], authors:[escrow]}
2. Publicar el contrato          → firmar y publicar 1 evento kind:1339
3. Depositar                     → firmar 9734 + LNURL-pay estándar (o mandar al
                                   jugador a la UI de Luna, como hoy)
4. Seguir el estado              → 1 suscripción {kinds:[31340], "#e":[contrato]}
5. Reportar el ganador           → firmar y publicar 1 evento kind:1341 (server)
```

Sin API key, sin polling, sin backend salvo la clave del oráculo.

---

## 9. Checklist para el dev

- [ ] Tengo la coordenada `GAME` y el escrow declaró `terms` legibles.
- [ ] Mi juego tiene pubkey de oráculo, declarada en el 30023 del juego.
- [ ] Publico el contrato 1339 con `p` de participantes + markers
      `escrow`/`oracle`, `stake` y `deadline` (no `expiration`).
- [ ] Cada participante firma su 9734 tageando el contrato y paga el invoice
      del callback LNURL del escrow.
- [ ] Me suscribo al 31340 del contrato en vez de pollear.
- [ ] El game server firma el 1341 con la clave del oráculo — nunca decido el
      ganador con el score 31337 del cliente.
- [ ] Guardo los ids: contrato, recibos, resultado. Son mi comprobante ante
      cualquiera, incluso sin Luna Negra.

---

## Apéndice — kinds de esta extensión

| Kind | Qué | Firma | Tipo | Estado |
|---|---|---|---|---|
| 1339 | **Contrato de apuesta** | retador | regular (inmutable) | **estable** (congelado) |
| 1341 | **Resultado / anulación** | oráculo (o retador, solo void pre-fondeo) | regular (inmutable) | **estable** (congelado) |
| 31340 | **Estado del escrow** (`d`=contrato) y **terms** (`d`=`terms`) | escrow | addressable | **estable** (congelado) |
| 9734/9735 | Depósitos y payouts | participante / escrow | NIP-57 | estándar |
| 1111 | **Comentario de participación** (NIP-22, `E`/`e`=contrato) | participante | comentario | estándar |
| 1 | Comentarios sociales, nota de liquidación | cualquiera | regular | estándar |
