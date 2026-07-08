# NGE v2 — Nostr Game Escrow (reimaginado, estilo NWC)

> **Estado:** **implementado y en producción** — Luna Negra (escrow) + Tetris/Tetra
> (juego). Reemplaza a NGE v1. No busca compatibilidad con v1.
>
> **Nota de privacidad (importante).** El diseño original buscaba un escrow *privado*
> (todo cifrado, no auditable por terceros). Por decisión del operador, **eso se
> descartó**: en la práctica NGE v2 es **coordinación RPC privada + liquidación PÚBLICA**.
> El canal juego↔escrow (`create_bet`/`get_bet`/`report_result`) va cifrado, pero la
> apuesta se **ancla y liquida en Nostr con eventos públicos** (contrato, resultado,
> payout) y es **auditable por cualquiera** en `/apuestas/{betId}`. Ver §2 y §8. Las
> menciones a "privacidad total" / "no auditable" de abajo quedan como **contexto del
> diseño original**, no como el comportamiento actual.
>
> **Qué es.** La pieza de **escrow y apuestas** del [Nostr Games Protocol (NGP)](../nostr-games-protocol.md).
> NGP estandariza cómo los juegos hablan con plataformas como Luna Negra (identidad,
> presencia, invitaciones, room links, chat, marcador… **y NGE**). NGE es tan central
> que tiene nombre propio, pero es **solo** el escrow: crear apuestas, recibir
> depósitos, custodiar, consultar estado, resolver, pagar y reembolsar. El resto vive
> en otros componentes de NGP.

## 1. Modelo: "NWC para escrow de juegos"

NGE v2 es un **protocolo request/response (RPC)** calcado de [NWC / NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md):

- El **escrow** (Luna) tiene una **pubkey estable** publicada en la URI de conexión.
- El **juego** (Tetra) tiene una clave de **cliente** (el `secret` de la URI), que el
  escrow autorizó al emitir la credencial.
- Los mensajes de **coordinación** viajan como **eventos Nostr efímeros y cifrados
  (NIP-44)**. El relay es un **caño tonto**: solo transporta, no guarda historial.
- **La fuente de verdad vive en el escrow** (su DB), no en los relays. La coordinación
  RPC es privada; la **liquidación** (contrato, resultado, payout) se ancla en Nostr
  con **eventos públicos** y es auditable por cualquiera (§2, §8).

## 2. Garantías y no-objetivos (la parte honesta)

**Garantiza:** rapidez (RPC directo, sin grafo público que reconciliar para
coordinar), **coordinación privada** (el canal juego↔escrow va cifrado C↔S:
`create_bet`/`get_bet`/`report_result` no son observables), **autenticación
bidireccional** (el juego prueba ser el cliente autorizado; el escrow firma toda
respuesta con su clave estable), **custodia** del pozo por el escrow, y **destinos
acotados**: los payouts sólo pueden ir a las direcciones/identidades declaradas en
`create_bet`. Un `C` comprometido puede *elegir* al ganador, **no redirigir fondos** a
una dirección arbitraria (§8) — eso contiene el daño de una fuga del `secret`.

**Qué es privado y qué es público (lo implementado).** Sólo la **coordinación** RPC es
privada. La **liquidación es pública y auditable**, igual que el "escrow transparente"
de v1:

| Pieza | Visibilidad | Cómo |
|---|---|---|
| Coordinación (`create_bet`/`get_bet`/`report_result`/…) | **privada** | RPC cifrado NIP-44 (kinds efímeros 24940/24941) |
| Contrato de la apuesta | **pública** | nota `kind:1` firmada por el escrow (pubkeys de los asientos, stake, hash de términos, condición) |
| Resultado | **público** | `kind:1341` firmado por el oráculo gestionado del escrow |
| Payout al ganador | **público** | zap NIP-57 (`kind:9735`) a su lud16, anclado al contrato |
| Nota de liquidación | **pública** | `kind:1` con el resumen (ganador, montos, fees, recibos) |
| Depósito (el pago en sí) | privado | bolt11 plano al nodo del escrow (sin evento público) |

> La página `/apuestas/{betId}` de Luna Negra muestra **todo** el detalle. O sea: la
> apuesta **sí es auditable por terceros**. El diseño original pretendía lo contrario
> ("privacidad sobre transparencia"); se descartó a propósito. Lo único que v2 ganó de
> privacidad frente a v1 es que **la coordinación** ya no es un grafo público.

**No es trustless.** Custodia = tercero de confianza. Trustless real = DLCs sobre
Bitcoin, fuera de alcance.

**No-objetivos:** presencia, invitaciones, room links, chat, marcador → otros
componentes de NGP, no NGE.

## 3. Roles

| Rol | Clave | Qué hace |
|---|---|---|
| **Escrow (servicio)** | pubkey estable `S` (en la URI) | custodia el pozo, es la fuente de verdad, emite invoices, detecta pagos, paga premios, reembolsa. Firma toda respuesta. |
| **Juego (cliente)** | keypair `C` (`secret` de la URI) | orquesta las apuestas y **es el oráculo** (reporta resultados). Una `C` por juego. |
| **Jugadores** | pubkey Nostr (recomendado) o anónimo | pagan el bolt11 de su asiento (**no firman nada**). Con `pubkey`, el asiento **es su cuenta real** en el escrow (§8): la apuesta aparece en su perfil / `/bets` y el premio va a su lud16. Sin `pubkey` → asiento **anónimo** (invitado efímero; cobra por QR de retiro). |

## 4. URI de conexión

Misma forma que v1, **cambia el significado**:

```
nostr+nge://<S-pubkey>?relay=wss://relay.luna.fit&secret=<C-secret>
```

- `S-pubkey` (host): pubkey estable del escrow. El juego **cifra hacia ella** y
  **verifica** que las respuestas la firmen (punto 5 del rediseño).
- `relay` (1+): transporte.
- `secret`: clave del cliente `C`. Ya **no firma contratos públicos**: es la identidad
  del juego en el canal cifrado, autorizada por el escrow.

> Muere el `bind` event de v1: la config ahora se pide por RPC (`get_info`, §7).

## 5. Transporte y cifrado

- request / response / notification = eventos Nostr **efímeros** (kind 20000–29999: el
  relay no los persiste).
- `content` = JSON **cifrado con NIP-44** entre `C` y `S`.
- **request**: lo firma `C`, tag `["p", S]`.
- **response**: lo firma `S`, tags `["p", C]` y `["e", <id del request>]`.
- **notification** (futuro, §9): lo firma `S`, tag `["p", C]`.

### Kinds propuestos (espejo de NWC, pero efímeros)

| Kind | Qué | NWC análogo |
|---|---|---|
| `24940` | NGE request | 23194 |
| `24941` | NGE response | 23195 |
| `24942` | NGE notification | 23196/23197 |

## 6. Autenticación y anti-replay

- El escrow acepta un request solo si está **firmado por una `C` autorizada** (la que
  emitió la credencial). No hay descubrimiento público de clientes.
- El juego acepta una response solo si está **firmada por `S`** (la pubkey de la URI).
- **Replay:** cada request tiene id único (id del evento) + `created_at` dentro de una
  ventana de frescura; el escrow **deduplica por id**. Tag `["expiration", ts]` opcional.
- **El oráculo es el cliente.** `report_result` se confía porque viene firmado y
  cifrado por la `C` autorizada. **Sin TOFU, sin oráculo declarado en un evento público.**
  La autenticación reemplaza a la confianza-al-primer-uso de v1.
  > **Implementación:** la *confianza* la da el RPC autenticado de `C`, pero el `kind:1341`
  > **público** de resultado lo firma un **oráculo GESTIONADO** que Luna custodia por
  > proveedor (no el juego). Emitir una credencial NGE **garantiza** ese oráculo gestionado
  > (guard en la emisión, `ensureManagedOracle`); un proveedor con oráculo propio/BYO no
  > puede liquidar por NGE → `SELF_SIGNED_ORACLE` (§7).
- **Revocación de `C`.** El escrow puede invalidar una credencial (p. ej. `secret`
  filtrado): a partir de ahí todo request firmado por esa `C` → error `UNAUTHORIZED`.
  Es **estado interno del escrow**, no hay evento público de revocación. Recuperarse =
  emitir una credencial nueva (nueva `C`) y actualizar `NGE_CONNECTION` en el juego.

### 6.1 Entrega sobre relay efímero

El relay no persiste (§5): si `S` está offline cuando `C` publica, el mensaje se
pierde. Se compensa con **at-least-once del lado del cliente**:

- `C` **reenvía el mismo evento firmado** (mismo id) hasta recibir la response o agotar
  la ventana de frescura. Reenviar no daña: el escrow **cachea la response por id de
  request** y la reproduce ante un id ya visto (la dedup del anti-replay).
- Las **mutaciones son idempotentes por clave natural**, no sólo por id de evento:
  `report_result` y `cancel_bet` por `betId`; `create_bet` por un `clientRef` opcional
  que asigna el juego (dos `create_bet` con el mismo `clientRef` devuelven **el mismo
  `betId`**). Así un reintento tras un id nuevo tampoco duplica apuestas.
- El escrow nunca depende de recibir un request para avanzar de estado: los pagos los
  detecta su nodo; `report_result` es la única transición gatillada por `C`, y es
  idempotente.

## 7. Comandos (RPC)

Payload descifrado del request: `{ "method": "...", "params": { ... } }`
Payload descifrado de la response: `{ "result_type": "...", "result": { ... } }`
o `{ "result_type": "...", "error": { "code": "...", "message": "..." } }`.

### `get_info`  — reemplaza el `bind`
→ `{ methods: [...], version, currency: "sat", minStakeSats, maxStakeSats, feePct, devFeePct }`

### `create_bet`
`params`: `{ seats: [{ seatId, pubkey?, payoutAddress? }], stakeSats, condition?, deadlineSec?, clientRef?, roomId? }`
→ `{ betId, status, deposits: [{ seatId, bolt11, amountSats, expiresAt }] }`
- `seatId`: id estable que asigna el juego (puede ser una pubkey o lo que sea).
- `pubkey` / `payoutAddress`: opcionales; definen el **nivel de payout** (§8).
- `clientRef`: opcional, clave de idempotencia del juego (§6.1). Reintentar con el
  mismo `clientRef` devuelve el **mismo `betId`**, no crea otra apuesta.
- `roomId`: opcional, sala/partida del juego (correlación y display en el escrow).
  Opaco para el protocolo: no participa de la idempotencia ni del estado.
- `stakeSats` es **por asiento**; el pozo objetivo es `stakeSats × seats.length`.

### `get_bet`  — **la fuente de verdad; se hace polling de esto**
`params`: `{ betId }`
→ `{ betId, status, stakeSats, potSats, deadlineSec, seats: [{ seatId, deposited, bolt11?, payout? }], result? }`
- `status`: `pending_deposits | funded | resolving | settled | cancelled | expired | refunded`.
- Para asientos **sin pagar**, devuelve un `bolt11` **vigente** (lo re-emite si venció):
  así el polling también entrega los handles de depósito frescos.
- `payout` por asiento: `{ tier, sats, status, receiptId? }`.

### `report_result`  — solo el juego (oráculo)
`params`: `{ betId, winners: [seatId] }` (vacío = empate/anulación → reembolso)
→ `{ ok, status }`. El escrow liquida y paga.
- **Precondición:** sólo válido con `status = funded`. En `pending_deposits` → error
  `NOT_FUNDED`; en `resolving/settled` → ver finalidad.
- **`winners` ⊆ asientos fondeados.** Un `seatId` inexistente o no fondeado → error
  `BAD_WINNER`; no se liquida nada.
- **Finalidad (idempotente).** El **primer** `report_result` válido transiciona
  `funded → resolving → settled`. Un reintento **idéntico** (mismos `winners`) devuelve
  la misma response cacheada (§6.1). Un `report_result` **distinto** sobre una apuesta
  ya en `resolving/settled` → error `ALREADY_SETTLED`: el resultado no se puede
  reescribir una vez que empezó a pagar.
- **Reparto** (§8): pozo neto `= potSats − fees`, dividido **en partes iguales** entre
  `winners`; el resto no divisible en sats va al primer ganador. `winners` vacío =
  empate/anulación → cada asiento fondeado recupera su `stakeSats` (sin fee).

### `cancel_bet`
`params`: `{ betId }` → `{ ok, status }` (pre-fondeo → reembolso).

### Códigos de error
`error: { code, message }`. Códigos: `UNAUTHORIZED` (`C` no autorizada/revocada, §6),
`NOT_FOUND` (`betId` inexistente), `NOT_FUNDED` / `ALREADY_SETTLED` / `BAD_WINNER`
(`report_result`, arriba), `NOT_CANCELLABLE` (`cancel_bet` post-fondeo),
`STAKE_OUT_OF_RANGE` (fuera de `minStakeSats`/`maxStakeSats`), `EXPIRED_REQUEST`
(fuera de la ventana de frescura, §6). En `report_result`, cuando el oráculo del
proveedor es propio (BYO / self-signed) o la apuesta declaró su propio `oracle` en el
1339: `SELF_SIGNED_ORACLE` — Luna no custodia el secreto y no puede firmar el 1341; el
juego debe firmarlo y publicarlo/postearlo (**no reintentable** por el mismo camino).
Fallos de la bóveda de secretos server-side (`ORACLE_ENC_KEY` ausente/rotada o blob
AES-GCM que no autentica): `ORACLE_KEY_ERROR`; oráculo gestionado sin provisionar:
`ORACLE_NOT_PROVISIONED`.

## 8. Depósitos y payouts

**Depósitos (bolt11 plano).** `create_bet` devuelve un `bolt11` **distinto por asiento**,
emitido directo por el nodo del escrow (**sin zap, sin 9734/9735**). El jugador paga el
suyo; el escrow mapea invoice→asiento y detecta el pago por su `paymentHash`. El pago en
sí no es un evento público, pero **los asientos y el stake quedan públicos** en la
nota-contrato (§2) — el pozo es reconstruible desde Nostr.

**Identidad del asiento.** Con `pubkey`, el participante es la **cuenta real** del jugador
(match o alta por pubkey): la apuesta le pertenece —aparece en su perfil / `/bets`— y el
payout va a su lud16. Sin `pubkey`, el asiento es un **invitado efímero** que Luna custodia
(cobra por QR de retiro). **Ningún jugador firma su depósito**: el bolt11 plano lo cubre.

**Ciclo de fondeo y bordes.**
- `funded` requiere **todos** los asientos pagados antes de `deadlineSec`. Con fondeo
  parcial la apuesta queda en `pending_deposits`.
- **Deadline sin completar** → `expired`: el escrow **reembolsa** a cada asiento que sí
  pagó (a su `payoutAddress`, o retiro por QR si no dio destino) y nadie queda expuesto.
- **Pago tardío o a invoice vencida.** El escrow reemite `bolt11` por `get_bet` (§7),
  pero un nodo puede seguir aceptando la invoice vieja. Todo pago que llega cuando el
  asiento ya está pagado, o la apuesta está `expired/cancelled/settled`, **no entra al
  pozo: se reembolsa automáticamente** a su origen. El pozo sólo lo forman los pagos
  válidos dentro de la ventana.
- `cancel_bet` (§7) sólo pre-fondeo total; una vez `funded` la única salida es
  `report_result` (incl. `winners` vacío = anulación con reembolso).

**Payouts — cascada de 3 niveles por capacidad del destino del ganador.** El destino se
resuelve de la **identidad real** del ganador: el `lud16` de su perfil Nostr (kind:0)
—vía la `pubkey` del asiento— o el `payoutAddress` explícito. **No** del invitado efímero
(por eso se paga a la cuenta real, no a un asiento anónimo varado).

| El ganador tiene… | Payout | Zap en su perfil |
|---|---|---|
| `lud16` **con NIP-57** (perfil o `payoutAddress`) + `pubkey` | **zap social** (9735, tag `["nge","payout"]`) | sí |
| dirección Lightning **sin** zaps | pago LNURL plano ("zap no social") | no |
| nada | **retiro por QR** (lo reclama) | no |

- El nivel social **no se puede forzar**: un 9735 solo valida si el lud16 soporta
  NIP-57. Depende del *setup del jugador* → eso es lo "opcional".
- La cascada sólo cambia **cómo** cobra el ganador (auto vs. reclamo por QR), **no la
  privacidad**: la apuesta ya es pública (§2). El zap social además **ancla el premio al
  perfil** del ganador (queda como zap recibido); los otros niveles pagan igual, sin ese
  anclaje.
- El tag `nge-payout` permite a la capa social de NGP renderizarlo como **"ganó una
  apuesta"** (no como propina) y **excluir al escrow del leaderboard de "top zappers"**.
- **Comisiones y reparto.** Pozo neto `= potSats − houseFee − devFee` (`feePct`,
  `devFeePct` de `get_info`; ambas las retiene el escrow internamente). El neto se
  divide **en partes iguales** entre los `winners`; el sobrante indivisible en sats va
  al primer ganador. Cada porción baja por la cascada de 3 niveles según su destino.

## 9. Estado, verdad y push

- La **DB del escrow es autoritativa**. `get_bet` la refleja. Los relays **nunca**
  guardan estado.
- **v1 del protocolo: solo polling.** El juego hace `get_bet` periódicamente.
- **Después: push.** Una `notification` (`bet_updated { betId }`) **despierta** al
  cliente, pero `get_bet` **sigue siendo la fuente confiable** y el polling queda como
  respaldo. El push nunca transporta estado autoritativo.

## 10. Qué cambia respecto de v1

**Se va (de la coordinación):**
- `bind` event → `get_info` (RPC).
- estado público `kind:31340` → `get_bet` (RPC privado).
- contrato `kind:1339` firmado **por el juego** → lo arma el escrow por `create_bet`.
- `9734/9735` de **depósito** → **bolt11 plano** del nodo del escrow.
- TOFU / oráculo declarado en evento público → **oráculo gestionado** + auth por RPC.
- reconciliación por relays (`zap-bet-sync`) para coordinar → el escrow es la fuente de verdad.

**Se queda (liquidación pública, §2):** el escrow **sí** publica en Nostr una
**nota-contrato `kind:1`** (ancla + hash de términos + asientos), el **resultado
`kind:1341`** (oráculo gestionado), el **payout `kind:9735`** (zap al ganador) y la
**nota de liquidación `kind:1`**. La apuesta es **auditable**, como el escrow transparente
de v1. Lo que v2 privatizó es **la coordinación**, no la liquidación.

## 11. Versionado

`get_info.version` anuncia la versión. Los kinds efímeros quedan congelados en v1 de
la spec. Cambios incompatibles → bump de `version` + nuevo método, no reescritura de
kinds.

---

## Apéndice — flujo de una apuesta 1v1

```
Juego (C)                          Escrow (S)                     Jugadores
  │  create_bet {seats, stake} ──▶  │
  │  ◀── {betId, deposits[bolt11]}  │
  │  (muestra el QR a cada jugador) │◀──── paga su bolt11 ────────── A, B
  │  get_bet (polling) ──────────▶  │  (detecta pagos)
  │  ◀── {status: funded}           │
  │        …se juega la partida…    │
  │  report_result {winners:[A]} ─▶ │  liquida, paga a A (§8), fee interna
  │  ◀── {ok, status: settled}      │  ── zap social a A si tiene lud16 ──▶ feed/leaderboard
  │  get_bet ────────────────────▶  │
  │  ◀── {status: settled, result}  │
```
