import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools";
import {
  buildGameArticleTemplate,
  gameArticleCoord,
  type GameArticleInput,
} from "@/lib/game-article";
import {
  validateProviderArticle,
  validateProviderDeletion,
} from "@/lib/game-article-validate";

// Juego canónico de prueba (la "ficha en la DB" contra la que se valida).
const GAME: GameArticleInput = {
  slug: "mi-juego",
  title: "Mi Juego",
  description: "<p>Un juego de prueba</p>",
  categories: ["accion"],
  priceSats: 100,
  coverUrl: "https://example.com/cover.png",
  horizontalCoverUrl: null,
  screenshots: JSON.stringify(["https://example.com/s1.png"]),
  videos: "[]",
  gameUrl: "https://mi-juego.example.com",
};

const PAGE_URL = "https://luna.example.com/game/mi-juego";

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

/** Firma el template canónico tal cual lo devolvería el endpoint del server. */
function signCanonical(overrides?: {
  publishedAt?: number;
  mutate?: (tpl: { kind: number; created_at: number; tags: string[][]; content: string }) => void;
  signWith?: Uint8Array;
}): Event {
  const tpl = buildGameArticleTemplate(GAME, {
    gamePageUrl: PAGE_URL,
    publishedAt: overrides?.publishedAt ?? Math.floor(Date.now() / 1000) - 3600,
  });
  overrides?.mutate?.(tpl);
  return finalizeEvent(tpl, overrides?.signWith ?? sk);
}

describe("validateProviderArticle", () => {
  it("acepta el template canónico firmado por el proveedor", () => {
    const ev = signCanonical();
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.id).toBe(ev.id);
  });

  it("rechaza una firma de OTRA cuenta (pubkey ajena)", () => {
    const ev = signCanonical({ signWith: generateSecretKey() });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tu cuenta/);
  });

  it("rechaza un artículo de otro juego (tag d ≠ slug)", () => {
    const ev = signCanonical({
      mutate: (tpl) => {
        tpl.tags = tpl.tags.map((t) => (t[0] === "d" ? ["d", "otro-juego"] : t));
      },
    });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza content adulterado (descripción distinta de la ficha)", () => {
    const ev = signCanonical({
      mutate: (tpl) => {
        tpl.content = "<p>Descripción trucha que el admin no revisó</p>";
      },
    });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/volvé a firmar/);
  });

  it("rechaza un tag adulterado (precio distinto de la ficha)", () => {
    const ev = signCanonical({
      mutate: (tpl) => {
        tpl.tags = tpl.tags.map((t) => (t[0] === "price" ? ["price", "1"] : t));
      },
    });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza un evento con la firma rota (contenido pisado después de firmar)", () => {
    const ok = signCanonical();
    const forged = JSON.parse(JSON.stringify(ok)) as Event;
    forged.content = "otra cosa";
    const r = validateProviderArticle({
      signedEvent: forged,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/firma.*no verifica/i);
  });

  it("rechaza published_at en el futuro", () => {
    const ev = signCanonical({ publishedAt: Math.floor(Date.now() / 1000) + 7200 });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza kinds que no son 30023", () => {
    const ev = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["d", GAME.slug]], content: "" },
      sk,
    );
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza basura sin forma de evento", () => {
    const r = validateProviderArticle({
      signedEvent: { hola: "mundo" },
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(false);
  });

  it("preserva el published_at del evento al reconstruir (re-firma con fecha original)", () => {
    // Un artículo re-firmado 1 año después con el published_at ORIGINAL: válido.
    const original = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
    const ev = signCanonical({ publishedAt: original });
    const r = validateProviderArticle({
      signedEvent: ev,
      game: GAME,
      expectedPubkey: pubkey,
      gamePageUrl: PAGE_URL,
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateProviderDeletion", () => {
  const articleId = signCanonical().id;
  const coord = gameArticleCoord(pubkey, GAME.slug);

  function signDeletion(opts?: { tags?: string[][]; signWith?: Uint8Array }): Event {
    return finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: opts?.tags ?? [["e", articleId], ["a", coord], ["k", "30023"]],
        content: "Juego eliminado",
      },
      opts?.signWith ?? sk,
    );
  }

  it("acepta un kind:5 del proveedor que referencia el artículo", () => {
    const r = validateProviderDeletion({
      signedEvent: signDeletion(),
      expectedPubkey: pubkey,
      nostrEventId: articleId,
      nostrCoord: coord,
    });
    expect(r.ok).toBe(true);
  });

  it("acepta referencia solo por coordenada (sin tag e)", () => {
    const r = validateProviderDeletion({
      signedEvent: signDeletion({ tags: [["a", coord]] }),
      expectedPubkey: pubkey,
      nostrEventId: articleId,
      nostrCoord: coord,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza un kind:5 firmado por otra cuenta", () => {
    const r = validateProviderDeletion({
      signedEvent: signDeletion({ signWith: generateSecretKey() }),
      expectedPubkey: pubkey,
      nostrEventId: articleId,
      nostrCoord: coord,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza un kind:5 que referencia OTRO evento", () => {
    const r = validateProviderDeletion({
      signedEvent: signDeletion({ tags: [["e", "0".repeat(64)]] }),
      expectedPubkey: pubkey,
      nostrEventId: articleId,
      nostrCoord: coord,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza kinds que no son 5", () => {
    const ev = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["e", articleId]], content: "" },
      sk,
    );
    const r = validateProviderDeletion({
      signedEvent: ev,
      expectedPubkey: pubkey,
      nostrEventId: articleId,
      nostrCoord: coord,
    });
    expect(r.ok).toBe(false);
  });
});
