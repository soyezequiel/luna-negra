# NGE SDK — quickstart (v2)

> El SDK vive en [`sdk/nge.ts`](../../sdk/nge.ts). Solo depende de `nostr-tools`.
> Corre server-side (guarda la clave `secret` de la URI). Spec:
> [`nge-v2-spec.md`](nge-v2-spec.md). Test: [`tests/nge-sdk.test.ts`](../../tests/nge-sdk.test.ts).

NGE v2 es la **"NWC del escrow"**: un RPC request/response calcado de NIP-47. El
juego (`C`, el `secret`) le habla al escrow (`S`, el host de la URI) por eventos
Nostr **efímeros cifrados con NIP-44**. El relay es un caño tonto; la fuente de
verdad vive en el escrow y se consulta con `get_bet` (polling). Sin API key, sin
`bind` event. La **coordinación** es privada (RPC cifrado); la **liquidación**
(contrato, resultado, payout) se ancla en Nostr con **eventos públicos** y es auditable
(ver [spec §2](nge-v2-spec.md)).

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
//    `info.transparency === "public"` = este escrow liquida en Nostr con eventos
//    públicos auditables (formato NGP); `visibilityOptions` = modos por-apuesta.
const info = await nge.getInfo();

// 1) Crear la apuesta. Devuelve EL DETALLE COMPLETO (mismo shape que get_bet)
//    más un bolt11 POR ASIENTO para mostrar como QR — no hace falta un get_bet
//    posterior a la creación (v1.1).
const bet = await nge.createBet({
  seats: [
    { seatId: "alice", pubkey: alicePubkey, payoutAddress: "alice@getalby.com" }, // payout social/LNURL
    { seatId: "bob" }, // pelado → cobra por QR de retiro
  ],
  stakeSats: 1000, // sats POR ASIENTO; el pozo objetivo es stake × asientos
  condition: "Mejor de 3 en Pac-Toshi",
  clientRef: "match-42", // idempotencia: reintentar con el mismo ref → mismo betId
  roomId: "sala-8vdu", // opcional: sala/partida (correlación + display en el escrow)
  // visibility: "unlisted", // opcional: omite la sombra 31340 y la nota social
});
for (const d of bet.deposits) {
  showQr(d.seatId, d.bolt11); // el jugador del asiento paga su invoice
}

// 2) Seguir el estado. Con un proceso persistente, `watchBet` combina el push
//    24942 (`bet_updated`, latencia de segundos) con polling de respaldo; cada
//    aviso se confirma con `get_bet` (la fuente de verdad). En serverless usá
//    `pollBet` (solo polling), como en v1.0.
const stop = nge.watchBet(bet.betId, (b) => {
  console.log(b.status, b.seats.map((s) => s.deposited));
});

// 3) Reportar el ganador por seatId (el juego ES el oráculo). Vacío = empate/anulación.
await nge.reportResult(bet.betId, ["alice"]);

// 4) (Opcional) Cancelar PRE-fondeo (reembolsa a los que ya pagaron).
// await nge.cancelBet(bet.betId);
```

Eso es todo el flujo. Sin `LUNA_NEGRA_NGP_*`, sin `fetchNgpConfig`, sin oráculo
declarado: la URI + el RPC `get_info` los reemplazan.

> **Identidad y cobro.** Pasá la `pubkey` Nostr del jugador en su asiento: el escrow lo
> trata como su **cuenta real** (la apuesta aparece en su perfil / `/bets`) y le paga el
> premio **automático** al `lud16` de su perfil (zap social). Sin `pubkey`, el asiento es
> anónimo y cobra por **QR de retiro**. El jugador **no firma** nada: paga el `bolt11` y
> listo (depósito plano).

## API

| Método | Qué hace |
|---|---|
| `NGE.fromEnv(envVar?, opts?)` / `NGE.connect(uri, opts?)` | crea el cliente desde la URI |
| `nge.getInfo()` | config/capacidades del escrow: `min/maxStakeSats`, `feePct`, `devFeePct`, `methods`, `version`, `transparency`, `visibilityOptions` |
| `nge.createBet(input)` | crea la apuesta; devuelve el **detalle completo** (shape de `getBet`) más `deposits:[{ seatId, bolt11, amountSats, expiresAt }]` |
| `nge.getBet(betId)` | la fuente de verdad: estado, asientos (con `deposited`/`bolt11` vigente/`payout`) y `result` |
| `nge.reportResult(betId, winners)` | reporta ganadores por `seatId` (vacío = empate/anulación → reembolso); con ventana de disputa devuelve `settleAt` |
| `nge.cancelBet(betId)` | cancela **pre-fondeo** (fondeada → usar `reportResult` con `winners` vacío) |
| `nge.watchBet(betId, cb, intervalMs?)` | push 24942 + polling de respaldo; cada aviso se confirma con `getBet`; devuelve `stop` |
| `nge.pollBet(betId, cb, intervalMs?)` | solo polling (para serverless): llama `cb` solo en cambios de estado; devuelve `stop` |
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
[test vectors](https://github.com/soyezequiel/Nostr-Game-Protocol/blob/main/vectors/nge-test-vectors.json) (mismo `content`/`id`, firmas que verifican).
