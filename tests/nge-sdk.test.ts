import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { verifyEvent, type Event } from "nostr-tools/pure";
import {
  NGE,
  parseNgeUri,
  contractTemplate,
  resultTemplate,
  depositRequestTemplate,
  type NgeTransport,
} from "../sdk/nge";

// Los vectores firmados son el contrato de conformidad (docs/nge/). El SDK se
// valida contra ELLOS: misma URI, mismos tags de contrato/resultado, mismos ids.
const V = JSON.parse(
  readFileSync(new URL("../docs/nge/test-vectors.json", import.meta.url), "utf8"),
) as any;

// ── Transporte falso: sirve queries desde una semilla y guarda lo publicado ──
function matches(ev: Event, f: Record<string, unknown>): boolean {
  if (Array.isArray(f.kinds) && !f.kinds.includes(ev.kind)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(ev.pubkey)) return false;
  for (const [k, vals] of Object.entries(f)) {
    if (!k.startsWith("#") || !Array.isArray(vals)) continue;
    const name = k.slice(1);
    const has = ev.tags.some((t) => t[0] === name && vals.includes(t[1]));
    if (!has) return false;
  }
  return true;
}

function fakeTransport(seed: Event[]) {
  const store = [...seed];
  const published: Event[] = [];
  const t: NgeTransport & { published: Event[] } = {
    published,
    async publish(ev) {
      published.push(ev);
      store.push(ev);
    },
    async query(f) {
      return store.filter((e) => matches(e, f as Record<string, unknown>));
    },
    subscribe(f, onEvent) {
      store.filter((e) => matches(e, f as Record<string, unknown>)).forEach(onEvent);
      return () => {};
    },
    close() {},
  };
  return t;
}

describe("parseNgeUri", () => {
  it("deriva escrow/relays/oráculo del string mínimo de 3 campos", () => {
    const c = parseNgeUri(V.connectionUri.uri);
    expect(c.escrowPubkey).toBe(V.connectionUri.parsed.escrowPubkey);
    expect(c.relays).toEqual(V.connectionUri.parsed.relays);
    expect(c.oraclePubkey).toBe(V.connectionUri.parsed.oraclePubkey);
    expect(c.oraclePubkey).toBe(V.actors.service.pubkey); // = getPublicKey(secret)
  });

  it("rechaza esquema y campos faltantes", () => {
    expect(() => parseNgeUri("https://foo?x=1")).toThrow(/nostr\+nge/);
    expect(() => parseNgeUri(`nostr+nge://${V.actors.escrow.pubkey}?secret=x`)).toThrow(/relay/);
    expect(() => parseNgeUri(`nostr+nge://${V.actors.escrow.pubkey}?relay=wss://r`)).toThrow(
      /secret/,
    );
  });
});

describe("builders puros vs vectores", () => {
  const contractTags = V.happyPath.contract.tags;

  it("contractTemplate reproduce los tags del contrato 1339 del vector", () => {
    const tmpl = contractTemplate(
      {
        seats: [V.actors.alice.pubkey, V.actors.bob.pubkey],
        stakeSats: V.constants.STAKE_SATS,
        deadlineSec: V.constants.DEADLINE,
        memo: V.happyPath.contract.content,
        tags: ["nge"], // el vector usa solo t=nge (el SDK por defecto agrega el alias)
      },
      {
        escrowPubkey: V.actors.escrow.pubkey,
        oraclePubkey: V.actors.service.pubkey,
        gameCoord: V.constants.GAME_COORD,
        relayHint: V.constants.RELAY,
      },
    );
    expect(tmpl.kind).toBe(1339);
    expect(tmpl.tags).toEqual(contractTags);
    expect(tmpl.content).toBe(V.happyPath.contract.content);
  });

  it("resultTemplate reproduce los tags del 1341 del vector", () => {
    const tmpl = resultTemplate({
      contractId: V.happyPath.contract.id,
      gameCoord: V.constants.GAME_COORD,
      winners: [V.actors.alice.pubkey],
      meta: { score: "3-1" },
      tags: ["nge"],
    });
    expect(tmpl.kind).toBe(1341);
    expect(tmpl.tags).toEqual(V.happyPath.result.tags);
  });

  it("depositRequestTemplate arma el 9734 con amount = stake en msat", () => {
    const tmpl = depositRequestTemplate({
      contractId: V.happyPath.contract.id,
      escrowPubkey: V.actors.escrow.pubkey,
      stakeSats: V.constants.STAKE_SATS,
      relays: [V.constants.RELAY],
    });
    expect(tmpl.kind).toBe(9734);
    expect(tmpl.tags).toContainEqual(["amount", String(V.constants.STAKE_MSAT)]);
    expect(tmpl.tags).toContainEqual(["e", V.happyPath.contract.id]);
  });
});

describe("todos los eventos del vector verifican firma", () => {
  it("15 eventos válidos", () => {
    const all: Event[] = [
      V.terms.event,
      V.bind.event,
      V.happyPath.contract,
      V.happyPath.deposits.alice,
      V.happyPath.deposits.bob,
      V.happyPath.states.accepted,
      V.happyPath.states.funded,
      V.happyPath.states.resolved,
      V.happyPath.result,
      ...V.adversarial.map((a: any) => a.event),
    ];
    expect(all.length).toBe(15);
    for (const ev of all) expect(verifyEvent(ev)).toBe(true);
  });
});

describe("NGE (con transporte falso)", () => {
  function connect(seed: Event[]) {
    return NGE.connect(V.connectionUri.uri, { transport: fakeTransport(seed) });
  }

  it("binding() resuelve coordenada/lud16/límites del bind event", async () => {
    const nge = connect([V.bind.event]);
    const b = await nge.binding();
    expect(b.gameCoord).toBe(V.constants.GAME_COORD);
    expect(b.lud16).toBe(V.constants.LUD16);
    expect(b.minStakeSats).toBe(100);
    expect(b.maxStakeSats).toBe(100000);
  });

  it("createBet firma+publica un 1339 válido y devuelve handles de depósito", async () => {
    const nge = connect([V.bind.event]);
    const res = await nge.createBet({
      seats: [V.actors.alice.pubkey, V.actors.bob.pubkey],
      stakeSats: 1000,
      deadlineSec: V.constants.DEADLINE,
      memo: "test",
    });
    expect(res.contractId).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEvent(res.event)).toBe(true);
    expect(res.event.pubkey).toBe(V.actors.service.pubkey); // firmado por el oráculo/servicio
    expect(res.deposits).toHaveLength(2);
    expect(res.deposits[0].request.tags).toContainEqual(["e", res.contractId]);
    expect(res.deposits[0].lud16).toBe(V.constants.LUD16);
  });

  it("createBet rechaza stake fuera de los límites del bind", async () => {
    const nge = connect([V.bind.event]);
    await expect(
      nge.createBet({ seats: [V.actors.alice.pubkey, V.actors.bob.pubkey], stakeSats: 200000 }),
    ).rejects.toThrow(/STAKE_OUT_OF_RANGE|fuera/);
  });

  it("reportResult firma+publica un 1341 del oráculo", async () => {
    const nge = connect([V.bind.event]);
    const r = await nge.reportResult(V.happyPath.contract.id, {
      winners: [V.actors.alice.pubkey],
      meta: { score: "3-1" },
    });
    expect(verifyEvent(r.event)).toBe(true);
    expect(r.event.kind).toBe(1341);
    expect(r.event.pubkey).toBe(V.actors.service.pubkey);
    expect(r.event.tags).toContainEqual(["status", "win"]);
  });

  it("state() lee el 31340 más nuevo firmado por el escrow", async () => {
    // Semilla: accepted y funded del vector; debe ganar funded (created_at mayor).
    const nge = connect([V.happyPath.states.accepted, V.happyPath.states.funded]);
    const s = await nge.state(V.happyPath.contract.id);
    expect(s?.status).toBe("funded");
    expect(s?.content.potSats).toBe(2000);
  });
});
