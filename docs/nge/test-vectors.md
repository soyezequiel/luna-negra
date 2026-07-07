# NGE v2 — Test Vectors

> **NGE = Nostr Game Escrow.** Vectores de prueba para validar cualquier
> implementación del **RPC cifrado estilo NWC** de [NGE v2](nge-v2-spec.md):
> requests `kind:24940` y responses `kind:24941`, cifrados con **NIP-44** entre el
> juego (`C`) y el escrow (`S`). No hay eventos públicos: la fuente de verdad vive
> en el escrow y se consulta por RPC.

Los datos vivos están en [`test-vectors.json`](test-vectors.json) (generado por
[`gen-vectors.js`](gen-vectors.js), claves y nonce fijos). Este doc los explica.

## Cómo se verifican

- Las **claves son de prueba y deterministas** (`escrow = "11"×32`,
  `client = "22"×32`, `attacker = "66"×32`). Nunca usarlas en producción.
- El **nonce NIP-44 es fijo** (`"ab"×32`) solo para reproducir los vectores → el
  `content` cifrado y el `id` de cada evento son estables. En producción el nonce
  es aleatorio por mensaje.
- La **clave de conversación es simétrica** (`C↔S`): el mismo ciphertext lo cifra
  `C` y lo descifra `S`, y viceversa. Está en `crypto.conversationKey`.
- Las **firmas se VERIFICAN, no se comparan** carácter a carácter (BIP-340 usa
  `aux` aleatorio): correr `verifyEvent(ev)` sobre cada evento debe dar `true`.

## Actores

| Rol | Clave | Quién |
|---|---|---|
| `escrow` (`S`) | `11…11` | el custodio (Luna Negra). **Host de la URI.** Firma toda response y descifra todo request. |
| `client` (`C`) | `22…22` | el juego. El `secret` de la URI. Firma todo request; el escrow lo autentica por esta pubkey. |
| `attacker` | `66…66` | clave hostil **sin credencial**, para el caso que el escrow debe rechazar. |

---

## 1. La URI de conexión (`nostr+nge://`) — mínima, 3 campos

El escrow **le genera al dev** un único string. El dev lo pega en
`NGE_CONNECTION=…` y no configura nada más — es la "NWC del escrow". A diferencia
de v1, **no hay `bind` event**: la config (límites, fees, métodos) se pide por RPC
con `get_info`.

```
nostr+nge://<escrow-pubkey>?relay=wss://relay.luna.fit&secret=<client-nsec>
```

| Parte | Por qué no se puede sacar |
|---|---|
| host = `<escrow-pubkey>` | identidad de `S`: el juego **cifra hacia ella** y **verifica** que toda response la firme |
| `relay` (repetible) | transporte; al menos uno (mismo motivo que NWC) |
| `secret` | clave de `C`: firma cada request. El escrow autentica al juego por su pubkey derivada |

**Lo que la SDK deriva** (ver `parsed` en el JSON):

```jsonc
{
  "escrowPubkey": "4f355bdc…75871aa",
  "relays": ["wss://relay.luna.fit"],
  "clientPubkey": "466d7fca…1bae3f27"   // = getPublicKey(secret)
}
```

---

## 2. Camino feliz (`canonical` en el JSON)

Cada entrada es un **par request/response**: el juego manda un `24940` cifrado, el
escrow contesta un `24941` cifrado con `["e", <id del request>]`. Orden típico de
una apuesta 1v1:

| # | Método | request (firma `C`) | response (firma `S`) |
|---|---|---|---|
| 1 | `get_info` | `{}` | `{ methods, version, currency, min/maxStakeSats, feePct, devFeePct }` |
| 2 | `create_bet` | `{ seats:[alice, bob], stakeSats, condition, clientRef }` | `{ betId, status:"pending_deposits", deposits:[{seatId, bolt11, amountSats, expiresAt}] }` |
| 3 | `get_bet` (polling) | `{ betId }` | `{ betId, status:"funded", stakeSats, potSats, deadlineSec, seats[], result:null }` |
| 4 | `report_result` | `{ betId, winners:["alice"] }` | `{ ok:true, status:"settled" }` |

- **`seats`**: `alice` trae `pubkey` + `payoutAddress` (lud16) → habilita el payout
  social/LNURL; `bob` va pelado → cobra por **QR de retiro**.
- **`clientRef`**: clave de idempotencia (§6.1 de la spec). Reintentar `create_bet`
  con el mismo `clientRef` devuelve el **mismo `betId`**.
- **Wire check**: `dec(request.content)` == `requestPayload` y
  `dec(response.content)` == `responsePayload` con la `conversationKey` del JSON.

---

## 3. Casos adversariales — qué debe DECIDIR el escrow (`adversarial`)

No son "eventos válidos que ignorar": documentan la **response de error correcta**
ante entradas hostiles o mal formadas. Un implementador de escrow
(`src/lib/nge-service.ts`) debe cumplirlos.

| `name` | `code` esperado | Regla (spec) |
|---|---|---|
| cliente sin credencial | `UNAUTHORIZED` | firma válida pero pubkey sin credencial emitida (§6) |
| request fuera de ventana | `EXPIRED_REQUEST` | `created_at` a >5 min del ahora (§6, anti-replay) |
| stake fuera de rango | `STAKE_OUT_OF_RANGE` | `stakeSats` fuera de `min/maxStakeSats` de `get_info` |
| ganador no fondeado | `BAD_WINNER` | `winners ⊄` asientos pagados (§7) |
| reporte sin fondear | `NOT_FUNDED` | `report_result` solo con `status=funded` (§7) |
| resultado ya liquidado | `ALREADY_SETTLED` | finalidad (§7): no se reescribe; reintento idéntico → ok |
| cancelar apuesta fondeada | `NOT_CANCELLABLE` | `cancel_bet` solo pre-fondeo total (§8) |

Los dos primeros traen un **evento firmado real** (`request` en el JSON) para
ejercitar auth y frescura; el resto define `method`/`params` de la mutación.

---

## 4. Checklist de conformidad (para quien implemente un escrow NGE v2)

- [ ] `verifyEvent` da `true` para todos los eventos canónicos y adversariales.
- [ ] Reconstruyo `parsed` desde la URI y `clientPubkey == getPublicKey(secret)`.
- [ ] Con la `conversationKey`, `content` descifra al payload esperado (ida y vuelta).
- [ ] Respondo el camino feliz `get_info → create_bet → get_bet → report_result`.
- [ ] Firmo toda response con `S` y la tagueo `["e", <id request>]`, `["p", C]`.
- [ ] Deduplico requests por id y **cacheo la response** (un reenvío no re-ejecuta).
- [ ] Devuelvo cada `code` adversarial esperado.

## Regenerar

```bash
node docs/nge/gen-vectors.js
```
