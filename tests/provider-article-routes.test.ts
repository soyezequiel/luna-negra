import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { Prisma } from "@prisma/client";
import { buildGameArticleTemplate } from "@/lib/game-article";

// Flujo del régimen articleSigner="provider": el submit exige la firma del
// proveedor, el approve del admin la difunde (sin firmar nada server-side) y el
// PATCH invalida firmas pendientes. La validación criptográfica corre DE VERDAD
// (claves de test); solo se mockean DB, relays y Discord.

const sk = generateSecretKey();
const ownerPubkey = getPublicKey(sk);

const GAME = {
  id: "game-1",
  providerId: "provider-1",
  slug: "mi-juego",
  title: "Mi Juego",
  description: "<p>desc</p>",
  categories: ["accion"],
  priceSats: 0,
  coverUrl: null,
  horizontalCoverUrl: null,
  screenshots: "[]",
  videos: "[]",
  gameUrl: null,
  status: "draft",
  articleSigner: "provider",
  signedArticle: null as unknown,
  articleDirty: false,
  nostrEventId: null as string | null,
  nostrCoord: null as string | null,
  nostrPublishedAt: null as Date | null,
  manualCaps: null,
  capsMode: null,
};

const mocks = vi.hoisted(() => ({
  session: {
    sub: "owner-1",
    npub: "npub-owner",
    pubkey: "",
  },
  gameFindUnique: vi.fn(),
  gameUpdate: vi.fn(),
  providerFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  ownedGame: vi.fn(),
  broadcastSignedEvent: vi.fn(),
  notifyGameSubmitted: vi.fn(),
  isAdmin: vi.fn(() => true),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
}));
vi.mock("@/lib/admin", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findUnique: mocks.gameFindUnique, update: mocks.gameUpdate },
    provider: { findFirst: mocks.providerFindFirst },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("@/lib/provider", () => ({ ownedGame: mocks.ownedGame }));
vi.mock("@/lib/discord", () => ({ notifyGameSubmitted: mocks.notifyGameSubmitted }));
vi.mock("@/lib/store-catalog", () => ({ revalidateCatalog: vi.fn() }));
vi.mock("@/lib/nostr-server", () => ({
  broadcastSignedEvent: mocks.broadcastSignedEvent,
  publishStoreArticleDeletion: vi.fn(async () => 1),
  getStorePubkey: vi.fn(() => null),
}));
vi.mock("@/lib/announce-game", () => ({
  syncGameToNostr: vi.fn(async (g: unknown) => g),
}));

const PAGE_URL = "https://luna.example/game/mi-juego";

/** Firma el template canónico del GAME de prueba, como lo haría el navegador. */
function signArticle(publishedAt = Math.floor(Date.now() / 1000) - 60) {
  return finalizeEvent(
    buildGameArticleTemplate(GAME, { gamePageUrl: PAGE_URL, publishedAt }),
    sk,
  );
}

beforeEach(() => {
  mocks.session = { sub: "owner-1", npub: "npub-owner", pubkey: ownerPubkey };
  mocks.gameFindUnique.mockReset();
  mocks.gameUpdate.mockReset().mockImplementation(async ({ data }) => ({
    ...GAME,
    ...data,
  }));
  mocks.providerFindFirst
    .mockReset()
    .mockResolvedValue({ id: "provider-1", ownerId: "owner-1", name: "Prov" });
  mocks.userFindUnique.mockReset().mockResolvedValue({ pubkey: ownerPubkey });
  mocks.ownedGame.mockReset().mockResolvedValue({
    provider: { id: "provider-1", ownerId: "owner-1" },
    game: { ...GAME },
  });
  mocks.broadcastSignedEvent.mockReset().mockResolvedValue(1);
  mocks.notifyGameSubmitted.mockReset().mockResolvedValue(undefined);
});

async function postSubmit(body?: unknown) {
  const { POST } = await import("@/app/api/provider/games/[id]/submit/route");
  const res = await POST(
    new Request("https://luna.example/api/provider/games/game-1/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: "game-1" }) },
  );
  return { status: res.status, json: await res.json() };
}

async function postApprove() {
  const { POST } = await import("@/app/api/admin/games/[id]/approve/route");
  const res = await POST(
    new Request("https://luna.example/api/admin/games/game-1/approve", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "game-1" }) },
  );
  return { status: res.status, json: await res.json() };
}

describe("submit con firma del proveedor", () => {
  it("rechaza el submit sin firma (juego provider)", async () => {
    mocks.gameFindUnique.mockResolvedValue({ ...GAME });
    const r = await postSubmit({});
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Falta tu firma/);
    expect(mocks.gameUpdate).not.toHaveBeenCalled();
  });

  it("acepta el submit con la firma canónica y la guarda sin publicar", async () => {
    mocks.gameFindUnique.mockResolvedValue({ ...GAME });
    const ev = signArticle();
    const r = await postSubmit({ signedEvent: ev });
    expect(r.status).toBe(200);
    expect(mocks.gameUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "in_review",
          signedArticle: expect.objectContaining({ id: ev.id }),
        }),
      }),
    );
    // Sin publicar: el broadcast recién ocurre cuando el admin aprueba.
    expect(mocks.broadcastSignedEvent).not.toHaveBeenCalled();
  });

  it("rechaza una firma que no corresponde a la ficha (título distinto)", async () => {
    mocks.gameFindUnique.mockResolvedValue({ ...GAME, title: "Título Nuevo" });
    const ev = signArticle(); // firmado con el título viejo
    const r = await postSubmit({ signedEvent: ev });
    expect(r.status).toBe(400);
  });

  it("rechaza si la sesión no es la cuenta dueña del proveedor", async () => {
    mocks.gameFindUnique.mockResolvedValue({ ...GAME });
    mocks.session.pubkey = "f".repeat(64); // otra cuenta
    const r = await postSubmit({ signedEvent: signArticle() });
    expect(r.status).toBe(403);
  });
});

describe("approve del admin (régimen provider)", () => {
  it("bloquea el approve sin firma guardada", async () => {
    mocks.gameFindUnique.mockResolvedValue({ ...GAME, status: "in_review" });
    const r = await postApprove();
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Falta la firma del proveedor/);
    expect(mocks.gameUpdate).not.toHaveBeenCalled();
  });

  it("con firma guardada: difunde el evento del proveedor y cachea SU coord", async () => {
    const ev = signArticle();
    mocks.gameFindUnique.mockResolvedValue({
      ...GAME,
      status: "in_review",
      signedArticle: ev,
    });
    // El update de status devuelve el juego con la firma para el broadcast.
    mocks.gameUpdate
      .mockResolvedValueOnce({ ...GAME, status: "published", signedArticle: ev })
      .mockImplementation(async ({ data }) => ({ ...GAME, ...data }));

    const r = await postApprove();
    expect(r.status).toBe(200);
    expect(mocks.broadcastSignedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: ev.id }),
    );
    // El write-through cachea la identidad DEL EVENTO (pubkey del proveedor).
    expect(mocks.gameUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nostrEventId: ev.id,
          nostrPubkey: ownerPubkey,
          nostrCoord: `30023:${ownerPubkey}:${GAME.slug}`,
          signedArticle: Prisma.DbNull,
        }),
      }),
    );
  });

  it("si ningún relay acepta, conserva la firma para reintentar", async () => {
    const ev = signArticle();
    mocks.gameFindUnique.mockResolvedValue({
      ...GAME,
      status: "in_review",
      signedArticle: ev,
    });
    mocks.gameUpdate.mockResolvedValueOnce({
      ...GAME,
      status: "published",
      signedArticle: ev,
    });
    mocks.broadcastSignedEvent.mockResolvedValue(0);

    const r = await postApprove();
    expect(r.status).toBe(200);
    // Un solo update (el de status): el write-through NO corre sin relays.
    expect(mocks.gameUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH invalida la firma pendiente", () => {
  async function patchGame(body: unknown) {
    const { PATCH } = await import("@/app/api/provider/games/[id]/route");
    const res = await PATCH(
      new Request("https://luna.example/api/provider/games/game-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "game-1" }) },
    );
    return { status: res.status, json: await res.json() };
  }

  it("editar la ficha de un juego in_review borra la firma guardada", async () => {
    mocks.ownedGame.mockResolvedValue({
      provider: { id: "provider-1", ownerId: "owner-1" },
      game: { ...GAME, status: "in_review", signedArticle: { id: "viejo" } },
    });
    const r = await patchGame({ title: "Otro título" });
    expect(r.status).toBe(200);
    expect(mocks.gameUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ signedArticle: Prisma.DbNull }),
      }),
    );
  });

  it("editar un juego published (provider) marca articleDirty y pide la firma", async () => {
    mocks.ownedGame.mockResolvedValue({
      provider: { id: "provider-1", ownerId: "owner-1" },
      game: { ...GAME, status: "published", signedArticle: null },
    });
    mocks.gameUpdate.mockImplementation(async ({ data }) => ({
      ...GAME,
      status: "published",
      ...data,
    }));
    const r = await patchGame({ title: "Otro título" });
    expect(r.status).toBe(200);
    expect(r.json.needsSignature).toBe(true);
    expect(mocks.gameUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ articleDirty: true }),
      }),
    );
  });

  it("editar solo capacidades (no ficha) NO invalida la firma", async () => {
    mocks.ownedGame.mockResolvedValue({
      provider: { id: "provider-1", ownerId: "owner-1" },
      game: { ...GAME, status: "in_review", signedArticle: { id: "viejo" }, manualCaps: null },
    });
    const r = await patchGame({ manualCap: { key: "identidad", value: true } });
    expect(r.status).toBe(200);
    const data = mocks.gameUpdate.mock.calls[0][0].data;
    expect(data.signedArticle).toBeUndefined();
    expect(data.articleDirty).toBeUndefined();
  });
});
