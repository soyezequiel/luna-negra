# NGE — Test Vectors

> **NGE = Nostr Game Escrow.** Vectores de prueba firmados para validar cualquier
> implementación de escrow o cliente contra el protocolo de apuestas por eventos
> (kinds **1339 / 1341 / 31340** + NIP-57). Es la capa de apuestas de
> [nostr-games-protocol-apuestas.md](../nostr-games-protocol-apuestas.md), acá
> presentada como algo que un tercero puede implementar y **autovalidar**.

Los datos vivos están en [`test-vectors.json`](test-vectors.json) (generado por
[`gen-vectors.js`](gen-vectors.js), claves fijas). Este doc los explica.

## Cómo se verifican

- Las **claves son de prueba y deterministas** (`sk = "11"×32`, `"22"×32`, …).
  Nunca usarlas en producción.
- Los **`id` de cada evento son estables** (sha256 de la serialización NIP-01).
- Las **firmas se VERIFICAN, no se comparan** carácter a carácter: BIP-340 usa un
  `aux` aleatorio, así que dos firmas del mismo evento difieren pero ambas validan.
  Un implementador corre `verifyEvent(ev)` sobre cada uno y debe dar `true`.

## Actores

| Rol | Clave | Quién |
|---|---|---|
| `escrow` | `11…11` | el custodio (Luna Negra). Firma los 31340. **Emite la URI.** |
| `service` | `22…22` | clave de servicio del juego = **oráculo**. Firma el 1339 y el 1341. |
| `alice` / `bob` | `33…33` / `44…44` | participantes (asientos). Firman su 9734 de depósito. |
| `dev` | `55…55` | autor del artículo 30023 del juego (define la coordenada). |
| `attacker` | `66…66` | clave hostil, para los casos que el escrow debe rechazar. |

---

## 1. La URI de conexión (`nostr+nge://`) — mínima, 3 campos

El escrow **le genera al dev** un único string. El dev lo pega en
`NGE_CONNECTION=…` y no configura nada más — es la "NWC del escrow". Solo lleva
lo **irreducible**; todo lo demás se deriva (§1.1).

```
nostr+nge://<escrow-pubkey>?relay=wss://relay.luna.fit&secret=<service-nsec>
```

| Parte | Por qué no se puede sacar |
|---|---|
| host = `<escrow-pubkey>` | es la identidad de a quién te conectás; valida que los 31340 estén firmados por el escrow correcto |
| `relay` (repetible) | necesitás al menos un relay de arranque (mismo motivo que NWC) |
| `secret` | tu credencial: **firma el 1339 y el 1341**. El `oraclePubkey` se **deriva** de ella |

**Lo que la SDK deriva** (ver `connectionUri.parsed`):

```jsonc
{
  "escrowPubkey": "4f355bdc…75871aa",
  "relays": ["wss://relay.luna.fit"],
  "serviceSecret": "2222…2222",
  "oraclePubkey": "9ac2…",     // = getPublicKey(serviceSecret)
  "mode": "self-signed"          // sin apikey => el juego firma sus 1341
}
```

### 1.1 El resto sale del `bind` event — no de la URI

Lo que antes viajaba en la URI (`a` coordenada del juego, `lud16`, límites de
stake, fees) lo publica el escrow como un evento **firmado y verificable**, y la
SDK lo resuelve en **un query de arranque** (cacheable):

```jsonc
{ "kinds":[31340], "authors":["<escrow>"], "#d":["bind:<oraclePubkey>"] }
```

El `bind` (ver `bind` en el JSON) es un kind:31340 addressable con
`d="bind:<oraclePubkey>"`, tag `a`=coordenada del juego, y en el content
`{ lud16, minStakeSats, maxStakeSats, feePct, devFeePct, … }`. **Ventaja:** si el
escrow cambia su `lud16` o la coordenada del juego, la SDK lo agarra sola — **sin
reemitir la credencial**. El `lud16` también está en el `kind:0` del escrow como
fallback estándar NIP-57.

**Por qué cierra el hueco TOFU.** El escrow **emite** la URI y publica el `bind`:
al hacerlo registra `oraclePubkey` (=pubkey del `secret`) como oráculo autorizado
para ese juego. La credencial + el bind **son** el registro → el escrow solo
acepta 1341 firmados por el oráculo que él mismo emitió, y cualquier tercero
verifica la cadena oráculo → juego leyendo el bind.

**Modo gestionado (opcional).** Si el string además trae `apikey=ln_sk_…` y un
`oracle=<pubkey-gestionada>` distinto del `secret`, el juego firma el 1339 con
`secret` pero reporta el resultado vía `/result` + API key (Luna firma el 1341).
Sigue siendo un solo string.

---

## 2. Camino feliz

Orden temporal de los eventos (`happyPath` + `terms` en el JSON):

| # | Evento | Kind | Firma | Qué pasa |
|---|---|---|---|---|
| — | `terms` | 31340 (`d=terms`) | escrow | condiciones globales del escrow: `min/maxStakeSats`, `feePct`, ventanas |
| — | `bind` | 31340 (`d=bind:<oracle>`) | escrow | ata oráculo → juego + `lud16` + límites; lo que la URI no carga (§1.1) |
| 0 | (bootstrap) | — | — | la SDK lee `terms`/`bind` y ya tiene toda la config |
| 1 | `contract` | 1339 | service | el reto: 2 asientos (alice, bob), `stake=1000`, `deadline`, roles `escrow`/`oracle` |
| 2 | `deposits.alice` / `.bob` | 9734 | alice / bob | zap request con `e=contract.id`, `amount=1000000` msat = aceptación |
| 3 | `states.accepted` | 31340 (`d=contract.id`) | escrow | contrato validado, esperando depósitos |
| 4 | `states.funded` | 31340 | escrow | los dos asientos depositaron; `potSats=2000` |
| 5 | `result` | 1341 | service (oráculo) | gana **alice** (`status=win`, `p=alice`) |
| 6 | `states.resolved` | 31340 | escrow | pagado; enlaza `resultEvent`, recibos de payout y `feeSats` |

`contract.id = fa8ca30e…5043c75` — este id **es** el hash de los términos: alterar
cualquier tag cambia el id (integridad gratis del protocolo).

Un cliente reconstruye toda la apuesta suscribiéndose a
`{ "kinds":[31340], "#e":["fa8ca30e…"] }` y siguiendo los enlaces.

---

## 3. Casos adversariales — qué debe decidir el escrow

Cada uno trae un evento **firmado y válido** (la firma verifica) pero que el
escrow **debe rechazar o ignorar** por reglas de negocio. Un implementador corre
su validador y compara el `code`/`expect`.

| `name` | `expect` | `code` | Regla violada |
|---|---|---|---|
| `stake-over-max` | REJECT | `STAKE_OUT_OF_RANGE` | `stake` 200000 > `maxStakeSats` 100000 de `terms` |
| `wrong-escrow` | REJECT | `WRONG_ESCROW` | el `p` con rol `escrow` no es la pubkey del escrow |
| `result-wrong-oracle` | REJECT | `ORACLE_MISMATCH` | el 1341 lo firma `attacker`, no el oráculo del contrato |
| `winner-not-participant` | REJECT | `WINNER_NOT_PARTICIPANT` | el ganador declarado no es un asiento del 1339 |
| `deposit-wrong-amount` | REJECT | `AMOUNT_MISMATCH` | el 9734 trae 500000 msat ≠ `stake` 1000000 msat |
| `double-result` | IGNORE | `ALREADY_RESOLVED` | segundo 1341 tras uno procesado; **el primero válido gana** (idempotente) |

> Estos códigos son los que ya usa la ingesta de Luna
> (`src/lib/ngp-bet-ingest.ts`, `src/lib/bet-oracle.ts`): los vectores son un
> contrato de conformidad, no una API nueva.

---

## 4. Checklist de conformidad (para quien implemente un escrow NGE)

- [ ] `verifyEvent` da `true` para los 15 eventos.
- [ ] Reconstruyo `parsed` desde la URI y `oraclePubkey == getPublicKey(secret)`.
- [ ] Recalculo `contract.id` desde sus tags y coincide (integridad).
- [ ] Acepto el camino feliz y transiciono `accepted → funded → resolved`.
- [ ] Rechazo/ignoro los 6 adversariales con el `code` esperado.
- [ ] Solo pago al ganador del **primer** 1341 válido firmado por el oráculo del
      contrato — nunca por el score kind:31337 del cliente.

## Regenerar

```bash
NODE_PATH="$(pwd)/node_modules" node docs/nge/gen-vectors.js
```
