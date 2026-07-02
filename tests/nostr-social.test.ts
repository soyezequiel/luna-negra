import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip44,
  type Event,
} from "nostr-tools";
import {
  challengeUrlFromEvent,
  clampContacts,
  contactsFromLatest,
  unwrapGiftWrap,
} from "@/lib/nostr-social";
import { createLocalSigner, setActiveSigner } from "@/lib/signer";

// Arma un gift-wrap NIP-17 (rumor kind:14 → seal kind:13 → gift-wrap kind:1059) a
// mano, como lo hace un cliente emisor (el reto 1v1 de un juego integrado). El
// seal lo firma el remitente; la capa externa usa una clave efímera.
function buildGiftWrap(opts: {
  fromSk: Uint8Array;
  toPubkey: string;
  content: string;
  rumorPubkeyOverride?: string; // para el caso de suplantación
}): Event {
  const fromPubkey = getPublicKey(opts.fromSk);
  const nowSec = Math.floor(Date.now() / 1000);
  const rumorBase = {
    kind: 14,
    pubkey: opts.rumorPubkeyOverride ?? fromPubkey,
    created_at: nowSec,
    tags: [["p", opts.toPubkey]],
    content: opts.content,
  };
  const rumor = { ...rumorBase, id: getEventHash(rumorBase) };
  const sealContent = nip44.encrypt(
    JSON.stringify(rumor),
    nip44.getConversationKey(opts.fromSk, opts.toPubkey),
  );
  const seal = finalizeEvent(
    { kind: 13, created_at: nowSec, tags: [], content: sealContent },
    opts.fromSk,
  );
  const ephemeralSk = generateSecretKey();
  const wrapContent = nip44.encrypt(
    JSON.stringify(seal),
    nip44.getConversationKey(ephemeralSk, opts.toPubkey),
  );
  return finalizeEvent(
    { kind: 1059, created_at: nowSec, tags: [["p", opts.toPubkey]], content: wrapContent },
    ephemeralSk,
  );
}

describe("contactsFromLatest", () => {
  it("elige el kind:3 más nuevo entre las respuestas de varios relays", () => {
    const viejo = {
      created_at: 100,
      tags: [
        ["p", "a"],
        ["p", "b"],
      ],
    };
    const nuevo = {
      created_at: 200,
      tags: [
        ["p", "a"],
        ["p", "b"],
        ["p", "c-recien-seguido"],
      ],
    };
    // El relay desactualizado responde primero: igual gana el más nuevo.
    expect(contactsFromLatest([viejo, nuevo])).toEqual([
      "a",
      "b",
      "c-recien-seguido",
    ]);
    expect(contactsFromLatest([nuevo, viejo])).toEqual([
      "a",
      "b",
      "c-recien-seguido",
    ]);
  });

  it("ignora tags que no son p o sin valor", () => {
    expect(
      contactsFromLatest([
        { created_at: 1, tags: [["p", "a"], ["e", "x"], ["p"]] },
      ]),
    ).toEqual(["a"]);
  });

  it("devuelve vacío sin eventos", () => {
    expect(contactsFromLatest([])).toEqual([]);
  });
});

describe("clampContacts", () => {
  it("conserva la cola (los follows nuevos van al final del kind:3)", () => {
    const contacts = Array.from({ length: 200 }, (_, i) => `pk${i}`);
    const out = clampContacts(contacts, 150);
    expect(out).toHaveLength(150);
    expect(out[0]).toBe("pk50");
    expect(out[out.length - 1]).toBe("pk199");
  });

  it("no recorta listas chicas y mantiene el orden", () => {
    expect(clampContacts(["a", "b", "c"], 150)).toEqual(["a", "b", "c"]);
  });

  it("deduplica conservando la última aparición", () => {
    expect(clampContacts(["a", "b", "a", "c"], 150)).toEqual(["b", "a", "c"]);
  });
});

describe("unwrapGiftWrap (NIP-17)", () => {
  it("desenvuelve un gift-wrap dirigido a mí y devuelve el rumor en claro", async () => {
    const senderSk = generateSecretKey();
    const meSk = generateSecretKey();
    const mePubkey = getPublicKey(meSk);
    setActiveSigner(createLocalSigner(meSk), { method: "local", nsec: "test" });

    const wrap = buildGiftWrap({
      fromSk: senderSk,
      toPubkey: mePubkey,
      content: "Te reto a una partida de TETRA.",
    });
    const rumor = await unwrapGiftWrap(wrap);
    expect(rumor).not.toBeNull();
    expect(rumor!.kind).toBe(14);
    expect(rumor!.content).toBe("Te reto a una partida de TETRA.");
    expect(rumor!.pubkey).toBe(getPublicKey(senderSk));
  });

  it("rechaza un rumor cuyo autor no coincide con el firmante del seal (anti-suplantación)", async () => {
    const senderSk = generateSecretKey();
    const meSk = generateSecretKey();
    const mePubkey = getPublicKey(meSk);
    setActiveSigner(createLocalSigner(meSk), { method: "local", nsec: "test" });

    // El seal lo firma `senderSk`, pero el rumor dice venir de otra pubkey.
    const wrap = buildGiftWrap({
      fromSk: senderSk,
      toPubkey: mePubkey,
      content: "reto falsificado",
      rumorPubkeyOverride: getPublicKey(generateSecretKey()),
    });
    expect(await unwrapGiftWrap(wrap)).toBeNull();
  });

  it("devuelve null si el gift-wrap es para otro destinatario (no puedo descifrarlo)", async () => {
    const senderSk = generateSecretKey();
    const meSk = generateSecretKey();
    const otherPubkey = getPublicKey(generateSecretKey());
    setActiveSigner(createLocalSigner(meSk), { method: "local", nsec: "test" });

    const wrap = buildGiftWrap({
      fromSk: senderSk,
      toPubkey: otherPubkey, // cifrado hacia otro, no hacia mí
      content: "no es para mí",
    });
    expect(await unwrapGiftWrap(wrap)).toBeNull();
  });
});

describe("challengeUrlFromEvent", () => {
  const rumor = (tags: string[][]): Event =>
    ({ kind: 14, tags, content: "", pubkey: "x", created_at: 0, id: "i", sig: "" } as Event);

  it("extrae el link de sala del tag url de un reto (kind:14)", () => {
    expect(
      challengeUrlFromEvent(rumor([["url", "https://tetra.app/?join=ROOM1"]])),
    ).toBe("https://tetra.app/?join=ROOM1");
  });

  it("ignora eventos que no son rumores kind:14", () => {
    const ev = { ...rumor([["url", "https://x/?join=1"]]), kind: 4 } as Event;
    expect(challengeUrlFromEvent(ev)).toBeNull();
  });

  it("rechaza urls que no son http(s) (evita esquemas peligrosos)", () => {
    expect(
      challengeUrlFromEvent(rumor([["url", "javascript:alert(1)"]])),
    ).toBeNull();
    expect(challengeUrlFromEvent(rumor([]))).toBeNull();
  });
});
