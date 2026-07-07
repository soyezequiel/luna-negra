# NGE SDK — quickstart (v2)

> El SDK vive en [`sdk/nge.ts`](../../sdk/nge.ts). Solo depende de `nostr-tools`.
> Corre server-side (guarda la clave `secret` de la URI). Spec:
> [`nge-v2-spec.md`](nge-v2-spec.md). Test: [`tests/nge-sdk.test.ts`](../../tests/nge-sdk.test.ts).

NGE v2 es la **"NWC del escrow"**: un RPC request/response calcado de NIP-47. El
juego (`C`, el `secret`) le habla al escrow (`S`, el host de la URI) por eventos
Nostr **efímeros cifrados con NIP-44**. El relay es un caño tonto; la fuente de
verdad vive en el escrow y se consulta con `get_bet` (polling). Sin API key, sin
eventos públicos (murió el grafo `1339/1341/31340` de v1), sin `bind` event.

## 1. Una variable de entorno

El escrow te da la credencial (una URI). La pegás y listo:

```bash
NGE_CONNECTION="nostr+nge://<escrow-pubkey>?relay=wss://relay.luna.fit&secret=<client-nsec>"
```

- **host** = pubkey estable del escrow `S`: el SDK cifra hacia ella y verifica que
  **toda** response la firme.
- **`relay`** (repetible) = transporte.
- **`secret`** = clave del cliente `C` (nsec). El escrow autentica al juego por la
  pubkey derivada de este `secret`.

## 2. El flujo, cinco llamadas

```ts
import { NGE } from "./sdk/nge";

const nge = NGE.fromEnv(); // lee NGE_CONNECTION (o NGE.connect(uri))

// 0) Config del escrow (reemplaza al bind de v1): límites, fees, métodos.
const info = await nge.getInfo();

// 1) Crear la apuesta. Devuelve un bolt11 POR ASIENTO para mostrar como QR.
const bet = await nge.createBet({
  seats: [
    { seatId: "alice", pubkey: alicePubkey, payoutAddress: "alice@getalby.com" }, // payout social/LNURL
    { seatId: "bob" }, // pelado → cobra por QR de retiro
  ],
  stakeSats: 1000, // sats POR ASIENTO; el pozo objetivo es stake × asientos
  condition: "Mejor de 3 en Pac-Toshi",
  clientRef: "match-42", // idempotencia: reintentar con el mismo ref → mismo betId
});
for (const d of bet.deposits) {
  showQr(d.seatId, d.bolt11); // el jugador del asiento paga su invoice
}

// 2) Seguir el estado: get_bet es la fuente de verdad. `pollBet` avisa SOLO en
//    las transiciones (pending_deposits → funded → settled).
const stop = nge.pollBet(bet.betId, (b) => {
  console.log(b.status, b.seats.map((s) => s.deposited));
});

// 3) Reportar el ganador por seatId (el juego ES el oráculo). Vacío = empate/anulación.
await nge.reportResult(bet.betId, ["alice"]);

// 4) (Opcional) Cancelar PRE-fondeo (reembolsa a los que ya pagaron).
// await nge.cancelBet(bet.betId);
```

Eso es todo el flujo. Sin `LUNA_NEGRA_NGP_*`, sin `fetchNgpConfig`, sin oráculo
declarado: la URI + el RPC `get_info` los reemplazan.

## API

| Método | Qué hace |
|---|---|
| `NGE.fromEnv(envVar?, opts?)` / `NGE.connect(uri, opts?)` | crea el cliente desde la URI |
| `nge.getInfo()` | config/capacidades del escrow: `min/maxStakeSats`, `feePct`, `devFeePct`, `methods`, `version` |
| `nge.createBet(input)` | crea la apuesta; devuelve `{ betId, status, deposits:[{ seatId, bolt11, amountSats, expiresAt }] }` |
| `nge.getBet(betId)` | la fuente de verdad: estado, asientos (con `deposited`/`bolt11` vigente/`payout`) y `result` |
| `nge.reportResult(betId, winners)` | reporta ganadores por `seatId` (vacío = empate/anulación → reembolso) |
| `nge.cancelBet(betId)` | cancela **pre-fondeo** (fondeada → usar `reportResult` con `winners` vacío) |
| `nge.pollBet(betId, cb, intervalMs?)` | polling con azúcar: llama `cb` solo en cambios de estado; devuelve `stop` |
| `nge.close()` | cierra los sockets |

**Entrega sobre relay efímero (§6.1 de la spec).** El relay no persiste: si el
escrow está offline el request se pierde. Por eso el SDK **reenvía el MISMO evento
firmado** (mismo id) cada `resendMs` hasta la response o el `timeoutMs`. El escrow
deduplica por id y cachea la response, así que reenviar nunca duplica efectos. Las
mutaciones además son idempotentes por clave natural (`betId`, o `clientRef` en
`create_bet`). Ajustable: `NGE.connect(uri, { timeoutMs, resendMs })`.

**Builders puros** (sin I/O, para tests o firma custom): `parseNgeUri`,
`requestTemplate`, `responseTemplate`, `encryptPayload`, `decryptPayload`,
`conversationKey`.

**Transporte inyectable:** `NGE.connect(uri, { transport })` — por defecto usa
`poolTransport(relays)` sobre `SimplePool`; en tests se pasa uno falso (ver el test).

## Estado del servidor

El lado escrow ya está implementado in-process en
[`src/lib/nge-service.ts`](../../src/lib/nge-service.ts): escucha los requests
`kind:24940` dirigidos a la tienda, autentica la credencial `C`, despacha al motor
de apuestas v2 y responde con `24941` firmados. Se arranca desde
`instrumentation.node.ts` (gateado por `BETS_V2_ENABLED`). La credencial se emite
en `POST /api/provider/nge/credential`.

El SDK produce eventos válidos verificados contra los
[test vectors](test-vectors.json) (mismo `content`/`id`, firmas que verifican).
