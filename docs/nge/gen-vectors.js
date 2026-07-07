/**
 * Generador de test vectors para NGE (Nostr Game Escrow).
 * Claves FIJAS y reproducibles: cualquiera puede re-firmar y verificar.
 * Los `id` son deterministas (sha256 de la serialización NIP-01);
 * las firmas schnorr llevan aux aleatorio, así que se VERIFICAN, no se comparan.
 */
const { finalizeEvent, getPublicKey, verifyEvent } = require("nostr-tools/pure");
const { nip19 } = require("nostr-tools");
const fs = require("fs");
const path = require("path");

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}

// ── Actores (claves de prueba, NO usar en producción) ───────────────────────
const SK = {
  escrow: "11".repeat(32), // Luna Negra (custodio)
  service: "22".repeat(32), // clave de servicio del juego = oráculo (self-signed)
  alice: "33".repeat(32), // participante A
  bob: "44".repeat(32), // participante B
  dev: "55".repeat(32), // autor del artículo 30023 del juego
  attacker: "66".repeat(32), // clave hostil (para casos adversariales)
};
const PK = Object.fromEntries(
  Object.entries(SK).map(([k, v]) => [k, getPublicKey(hexToBytes(v))]),
);

const T0 = 1751760000; // created_at base (fijo)
const DEADLINE = T0 + 3600; // ventana de fondeo
const GAME_COORD = `30023:${PK.dev}:pacman-pwa`;
const STAKE_SATS = 1000;
const STAKE_MSAT = STAKE_SATS * 1000;
const RELAY = "wss://relay.luna.fit";
const LUD16 = "luna@luna.naranja.fit";
const TAG = "nge"; // tag de descubrimiento (alias legacy: "ngp-bet")

function sign(sk, tmpl) {
  return finalizeEvent(tmpl, hexToBytes(SK[sk]));
}

// ── La URI de conexión NGE (self-signed / keyless) — MÍNIMA: 3 campos ────────
// Solo lo irreducible: a quién te conectás (host), dónde (relay) y con qué firmás
// (secret). Todo lo demás (coordenada del juego, lud16, límites, fees) lo deriva
// la SDK del `bindEvent` que publica el escrow (ver más abajo).
function buildUri() {
  const q = new URLSearchParams();
  q.set("relay", RELAY);
  q.set("secret", SK.service);
  return `nostr+nge://${PK.escrow}?${q.toString()}`;
}
const uri = buildUri();
const parsed = (() => {
  const u = new URL(uri);
  const p = u.searchParams;
  return {
    escrowPubkey: u.host,
    relays: p.getAll("relay"),
    serviceSecret: p.get("secret"),
    oraclePubkey: getPublicKey(hexToBytes(p.get("secret"))), // derivado del secret
    mode: "self-signed", // sin apikey => el juego firma sus 1341
  };
})();

// ── Eventos canónicos (camino feliz) ────────────────────────────────────────
// 1) terms (condiciones publicadas por el escrow)
const termsContent = {
  minStakeSats: 100,
  maxStakeSats: 100000,
  feePct: 2,
  devFeePct: 1,
  feeMinSats: 1,
  depositWindowSec: 3600,
  resolveWindowSec: 86400,
};
const terms = sign("escrow", {
  kind: 31340,
  created_at: T0 - 10,
  tags: [
    ["d", "terms"],
    ["t", TAG],
  ],
  content: JSON.stringify(termsContent),
});

// bind: el escrow ata oráculo -> juego + config, firmado y verificable. Es lo que
// la URI ya NO carga (coordenada + lud16 + límites). addressable con
// d="bind:<oraclePubkey>". La SDK lo resuelve al arrancar:
//   { kinds:[31340], authors:[escrow], "#d":["bind:<oracle>"] }
const bindEvent = sign("escrow", {
  kind: 31340,
  created_at: T0 - 5,
  tags: [
    ["d", `bind:${PK.service}`],
    ["p", PK.service], // el oráculo/servicio al que aplica
    ["a", GAME_COORD], // la coordenada del juego (lo que sacamos de la URI)
    ["t", TAG],
  ],
  content: JSON.stringify({ lud16: LUD16, ...termsContent }),
});

// 2) contrato 1339 (firma la clave de servicio = retador; oráculo = ella misma)
const contract = sign("service", {
  kind: 1339,
  created_at: T0,
  tags: [
    ["a", GAME_COORD],
    ["p", PK.alice],
    ["p", PK.bob],
    ["p", PK.escrow, RELAY, "escrow"],
    ["p", PK.service, RELAY, "oracle"],
    ["stake", String(STAKE_SATS)],
    ["deadline", String(DEADLINE)],
    ["t", TAG],
  ],
  content: "Apuesta 1v1 en Pac-Toshi, tablero clásico. Gana el mejor de 3.",
});

// 3) depósitos: zap request 9734 de cada participante (e = contrato)
function depositReq(who) {
  return sign(who, {
    kind: 9734,
    created_at: T0 + 30,
    tags: [
      ["e", contract.id],
      ["p", PK.escrow],
      ["amount", String(STAKE_MSAT)],
      ["relays", RELAY],
    ],
    content: "",
  });
}
const depositAlice = depositReq("alice");
const depositBob = depositReq("bob");

// 4) estado del escrow: accepted -> funded -> resolved
function state(status, extra, at) {
  return sign("escrow", {
    kind: 31340,
    created_at: at,
    tags: [
      ["d", contract.id],
      ["e", contract.id],
      ["a", GAME_COORD],
      ["status", status],
      ["t", TAG],
    ],
    content: JSON.stringify(extra),
  });
}
const stateAccepted = state("accepted", { potSats: 0, ...termsSlice() }, T0 + 5);
const stateFunded = state(
  "funded",
  {
    deposits: [
      { p: PK.alice, receipt: "<id 9735 alice>" },
      { p: PK.bob, receipt: "<id 9735 bob>" },
    ],
    potSats: STAKE_SATS * 2,
    ...termsSlice(),
  },
  T0 + 40,
);
function termsSlice() {
  return { feePct: termsContent.feePct, devFeePct: termsContent.devFeePct };
}

// 5) resultado 1341 (firma el oráculo = clave de servicio)
const result = sign("service", {
  kind: 1341,
  created_at: T0 + 120,
  tags: [
    ["e", contract.id],
    ["a", GAME_COORD],
    ["p", PK.alice], // ganadora
    ["status", "win"],
    ["t", TAG],
  ],
  content: JSON.stringify({ score: "3-1" }),
});

// 6) estado resolved
const stateResolved = state(
  "resolved",
  {
    resultEvent: result.id,
    winners: [PK.alice],
    payoutReceipt: "<id 9735 premio>",
    devFeeReceipt: "<id 9735 dev>",
    feeSats: 40,
    potSats: STAKE_SATS * 2,
  },
  T0 + 130,
);

// ── Casos adversariales: el escrow DEBE rechazar ────────────────────────────
const adversarial = [];

// A1: stake por encima del máximo publicado
adversarial.push({
  name: "stake-over-max",
  expect: "REJECT",
  code: "STAKE_OUT_OF_RANGE",
  why: `stake ${200000} > maxStakeSats ${termsContent.maxStakeSats}`,
  event: sign("service", {
    kind: 1339,
    created_at: T0,
    tags: [
      ["a", GAME_COORD],
      ["p", PK.alice],
      ["p", PK.bob],
      ["p", PK.escrow, RELAY, "escrow"],
      ["p", PK.service, RELAY, "oracle"],
      ["stake", "200000"],
      ["deadline", String(DEADLINE)],
      ["t", TAG],
    ],
    content: "stake fuera de rango",
  }),
});

// A2: contrato que nombra a OTRO como escrow (no a Luna)
adversarial.push({
  name: "wrong-escrow",
  expect: "REJECT",
  code: "WRONG_ESCROW",
  why: "el p-tag 'escrow' no es la pubkey del escrow que emite la URI",
  event: sign("service", {
    kind: 1339,
    created_at: T0,
    tags: [
      ["a", GAME_COORD],
      ["p", PK.alice],
      ["p", PK.bob],
      ["p", PK.attacker, RELAY, "escrow"], // <-- no es el escrow real
      ["p", PK.service, RELAY, "oracle"],
      ["stake", String(STAKE_SATS)],
      ["deadline", String(DEADLINE)],
      ["t", TAG],
    ],
    content: "escrow equivocado",
  }),
});

// A3: resultado firmado por una clave que NO es el oráculo del contrato
adversarial.push({
  name: "result-wrong-oracle",
  expect: "REJECT",
  code: "ORACLE_MISMATCH",
  why: "el 1341 lo firma attacker, pero el oráculo del contrato es service",
  event: sign("attacker", {
    kind: 1341,
    created_at: T0 + 120,
    tags: [
      ["e", contract.id],
      ["a", GAME_COORD],
      ["p", PK.attacker],
      ["status", "win"],
      ["t", TAG],
    ],
    content: JSON.stringify({ score: "9-0" }),
  }),
});

// A4: resultado que declara ganador que NO es participante
adversarial.push({
  name: "winner-not-participant",
  expect: "REJECT",
  code: "WINNER_NOT_PARTICIPANT",
  why: "attacker no está entre los p-participantes del contrato",
  event: sign("service", {
    kind: 1341,
    created_at: T0 + 120,
    tags: [
      ["e", contract.id],
      ["a", GAME_COORD],
      ["p", PK.attacker], // <-- no es asiento del contrato
      ["status", "win"],
      ["t", TAG],
    ],
    content: "",
  }),
});

// A5: depósito 9734 con monto distinto al stake
adversarial.push({
  name: "deposit-wrong-amount",
  expect: "REJECT",
  code: "AMOUNT_MISMATCH",
  why: `amount ${500 * 1000} msat != stake ${STAKE_MSAT} msat`,
  event: sign("alice", {
    kind: 9734,
    created_at: T0 + 30,
    tags: [
      ["e", contract.id],
      ["p", PK.escrow],
      ["amount", String(500 * 1000)],
      ["relays", RELAY],
    ],
    content: "",
  }),
});

// A6: segundo 1341 válido (replay/doble resultado) -> idempotente, se ignora
adversarial.push({
  name: "double-result",
  expect: "IGNORE",
  code: "ALREADY_RESOLVED",
  why: "ya se procesó un 1341 para este contrato; el primero válido gana",
  event: sign("service", {
    kind: 1341,
    created_at: T0 + 200,
    tags: [
      ["e", contract.id],
      ["a", GAME_COORD],
      ["p", PK.bob], // contradice el primero (ganó alice)
      ["status", "win"],
      ["t", TAG],
    ],
    content: "",
  }),
});

// ── Sanity: todo evento canónico y adversarial debe VERIFICAR firma ──────────
const allEvents = [
  terms,
  bindEvent,
  contract,
  depositAlice,
  depositBob,
  stateAccepted,
  stateFunded,
  result,
  stateResolved,
  ...adversarial.map((a) => a.event),
];
for (const ev of allEvents) {
  if (!verifyEvent(ev)) throw new Error(`firma inválida en ${ev.id}`);
}

// ── Salida ──────────────────────────────────────────────────────────────────
const out = {
  $schema: "NGE test vectors v1",
  note:
    "Claves de prueba deterministas. Los `id` son estables; las firmas se VERIFICAN (aux aleatorio de BIP340), no se comparan carácter a carácter.",
  actors: Object.fromEntries(
    Object.keys(SK).map((k) => [
      k,
      { sk: SK[k], pubkey: PK[k], npub: nip19.npubEncode(PK[k]) },
    ]),
  ),
  constants: { T0, DEADLINE, GAME_COORD, STAKE_SATS, STAKE_MSAT, RELAY, LUD16, tag: TAG },
  connectionUri: {
    uri,
    fields: 3,
    parsed,
    explain:
      "El dev pega esto en NGE_CONNECTION. 3 campos: host=escrow, relay, secret. La SDK deriva oraclePubkey del secret y resuelve gameCoord/lud16/límites del bindEvent. mode=self-signed => sin API key.",
    bootstrapFilter: {
      kinds: [31340],
      authors: [PK.escrow],
      "#d": [`bind:${PK.service}`],
    },
  },
  terms: { event: terms, content: termsContent },
  bind: {
    event: bindEvent,
    resolves: { gameCoord: GAME_COORD, lud16: LUD16, ...termsContent },
    explain:
      "Lo que la URI ya no carga. La SDK lo lee una vez al arrancar (cacheable). Si cambia la coordenada o el lud16 del escrow, se actualiza sin reemitir la credencial.",
  },
  happyPath: {
    contract,
    deposits: { alice: depositAlice, bob: depositBob },
    states: { accepted: stateAccepted, funded: stateFunded, resolved: stateResolved },
    result,
  },
  adversarial: adversarial.map((a) => ({
    name: a.name,
    expect: a.expect,
    code: a.code,
    why: a.why,
    event: a.event,
  })),
};

const dir = path.join("F:/proyectos/Tienda juegos PC Nostr/docs/nge");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "test-vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log("OK ->", path.join(dir, "test-vectors.json"));
console.log("contract.id =", contract.id);
console.log("result.id   =", result.id);
console.log("uri         =", uri);
console.log("events verificados:", allEvents.length);
