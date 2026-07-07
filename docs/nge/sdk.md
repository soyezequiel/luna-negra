# NGE SDK — quickstart

> El SDK vive en [`sdk/nge.ts`](../../sdk/nge.ts). Solo depende de `nostr-tools`.
> Corre server-side (guarda la clave de servicio). Test: [`tests/nge-sdk.test.ts`](../../tests/nge-sdk.test.ts).

## 1. Una variable de entorno

El escrow te da la credencial. La pegás y listo:

```bash
NGE_CONNECTION="nostr+nge://<escrow-pubkey>?relay=wss://relay.luna.fit&secret=<service-key>"
```

## 2. Cuatro llamadas

```ts
import { NGE } from "./sdk/nge";

const nge = NGE.fromEnv(); // lee NGE_CONNECTION (o NGE.connect(uri))

// Crear la apuesta: firma+publica el contrato 1339. Sin API key.
const bet = await nge.createBet({
  seats: [alicePubkey, bobPubkey], // hex o npub
  stakeSats: 1000,
  windowSec: 3600, // ventana de fondeo (o deadlineSec absoluto)
  memo: "Mejor de 3 en Pac-Toshi",
});

// Handles de depósito por asiento (cada jugador firma su 9734 y lo manda al LNURL).
for (const d of bet.deposits) {
  console.log(d.pubkey, d.lud16, d.request); // request = zap request sin firmar
}

// Seguir el estado (suscripción al 31340 del escrow).
const stop = nge.onState(bet.contractId, (s) => {
  console.log(s.status, s.content); // accepted → funded → resolved
});

// Reportar el ganador: firma+publica el 1341 con tu oráculo. Sin API key.
await nge.reportResult(bet.contractId, { winners: [alicePubkey], meta: { score: "3-1" } });
```

Eso es todo el flujo. Sin `LUNA_NEGRA_NGP_*`, sin `fetchNgpConfig`, sin
`ensureOracleDeclared`: la URI + el `bind` event los reemplazan.

## API

| Método | Qué hace |
|---|---|
| `NGE.fromEnv(envVar?)` / `NGE.connect(uri, opts?)` | crea el cliente desde la URI |
| `nge.binding()` | resuelve coordenada del juego, `lud16` y límites (del `bind` event, cacheado) |
| `nge.createBet(input)` | firma+publica el 1339; devuelve `{ contractId, event, deposits }` |
| `nge.reportResult(id, { winners, meta })` | firma+publica el 1341 (ganadores vacío = empate) |
| `nge.voidBet(id)` | firma+publica un 1341 `status=void` (anulación/reembolso) |
| `nge.state(id)` | último 31340 del escrow (una lectura) |
| `nge.onState(id, cb)` | suscripción a las transiciones; devuelve `unsubscribe` |
| `nge.close()` | cierra los sockets |

**Builders puros** (sin I/O, para tests o firma custom): `parseNgeUri`,
`contractTemplate`, `resultTemplate`, `depositRequestTemplate`, `voidTemplate`.

**Transporte inyectable:** `NGE.connect(uri, { transport })` — por defecto usa
`poolTransport(relays)` sobre `SimplePool`; en tests se pasa uno falso (ver el test).

## Qué falta para que funcione contra Luna hoy

El SDK ya produce eventos válidos (verificado contra los
[test vectors](test-vectors.json)). Para operar end-to-end contra el escrow real
falta el lado servidor (roadmap): el **emisor de la credencial**
(`POST /api/provider/nge/credential`) que genera/registra el par de servicio y
**publica el `bind` event**. Sin ese bind, `nge.binding()` tira `NO_BINDING`.
