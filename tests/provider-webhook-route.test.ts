import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks aislados: auth por API key, rate-limit y prisma.
let apiKeyProvider: string | null = "prov1";
vi.mock("@/lib/api-keys", () => ({
  verifyApiKey: vi.fn(async () => apiKeyProvider),
}));

let rlSuccess = true;
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    success: rlSuccess,
    limit: 30,
    remaining: rlSuccess ? 29 : 0,
    reset: 60,
  })),
  rateLimitHeaders: vi.fn(() => ({})),
}));

// Estado simulado del proveedor en la "DB".
let providerRow: { webhookUrl: string | null; webhookSecret: string | null } | null = {
  webhookUrl: null,
  webhookSecret: null,
};
let updateArgs: { where: unknown; data: { webhookUrl: string | null; webhookSecret?: string | null } }[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    provider: {
      findUnique: vi.fn(async () => providerRow),
      update: vi.fn(async (args: { where: unknown; data: { webhookUrl: string | null; webhookSecret?: string | null } }) => {
        updateArgs.push(args);
        // Refleja el patch sobre el estado actual (igual que Prisma).
        providerRow = {
          webhookUrl: args.data.webhookUrl,
          webhookSecret:
            "webhookSecret" in args.data
              ? (args.data.webhookSecret ?? null)
              : (providerRow?.webhookSecret ?? null),
        };
        return providerRow;
      }),
    },
  },
}));

async function post(body: unknown, withAuth = true) {
  const { POST } = await import("@/app/api/v1/provider/webhook/route");
  const req = new Request("http://x/api/v1/provider/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withAuth ? { authorization: "Bearer ln_sk_test" } : {}),
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

async function get(withAuth = true) {
  const { GET } = await import("@/app/api/v1/provider/webhook/route");
  const req = new Request("http://x/api/v1/provider/webhook", {
    headers: withAuth ? { authorization: "Bearer ln_sk_test" } : {},
  });
  const res = await GET(req);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  apiKeyProvider = "prov1";
  rlSuccess = true;
  providerRow = { webhookUrl: null, webhookSecret: null };
  updateArgs = [];
});

describe("POST /api/v1/provider/webhook", () => {
  it("setea la URL y genera un secreto cuando no había", async () => {
    const { status, json } = await post({ url: "https://game.example/hook" });
    expect(status).toBe(200);
    expect(json.url).toBe("https://game.example/hook");
    expect(json.secret).toMatch(/^whsec_/);
    // Acotado al proveedor de la key.
    expect(updateArgs[0].where).toEqual({ id: "prov1" });
  });

  it("conserva el secreto si ya existe y no se pide regenerar", async () => {
    providerRow = { webhookUrl: "https://old.example", webhookSecret: "whsec_viejo" };
    const { json } = await post({ url: "https://new.example/hook" });
    expect(json.url).toBe("https://new.example/hook");
    expect(json.secret).toBe("whsec_viejo");
    expect("webhookSecret" in updateArgs[0].data).toBe(false);
  });

  it("regenerate:true rota el secreto (invalida el anterior)", async () => {
    providerRow = { webhookUrl: "https://x.example", webhookSecret: "whsec_viejo" };
    const { json } = await post({ url: "https://x.example", regenerate: true });
    expect(json.secret).toMatch(/^whsec_/);
    expect(json.secret).not.toBe("whsec_viejo");
  });

  it("URL vacía borra webhookUrl y webhookSecret", async () => {
    providerRow = { webhookUrl: "https://x.example", webhookSecret: "whsec_viejo" };
    const { status, json } = await post({ url: "" });
    expect(status).toBe(200);
    expect(json.url).toBeNull();
    expect(json.secret).toBeNull();
    expect(updateArgs[0].data).toEqual({ webhookUrl: null, webhookSecret: null });
  });

  it("URL inválida → 400 INVALID_WEBHOOK_URL", async () => {
    const { status, json } = await post({ url: "ftp://nope" });
    expect(status).toBe(400);
    expect(json.error.code).toBe("INVALID_WEBHOOK_URL");
    expect(updateArgs).toHaveLength(0);
  });

  it("API key inválida → 401 INVALID_API_KEY", async () => {
    apiKeyProvider = null;
    const { status, json } = await post({ url: "https://x.example" });
    expect(status).toBe(401);
    expect(json.error.code).toBe("INVALID_API_KEY");
    expect(updateArgs).toHaveLength(0);
  });

  it("rate limit → 429 RATE_LIMITED", async () => {
    rlSuccess = false;
    const { status, json } = await post({ url: "https://x.example" });
    expect(status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(updateArgs).toHaveLength(0);
  });

  it("dos keys distintas tocan proveedores distintos (aislamiento)", async () => {
    apiKeyProvider = "prov2";
    await post({ url: "https://x.example" });
    expect(updateArgs[0].where).toEqual({ id: "prov2" });
  });
});

describe("GET /api/v1/provider/webhook", () => {
  it("devuelve la config actual sin rotar", async () => {
    providerRow = { webhookUrl: "https://x.example", webhookSecret: "whsec_actual" };
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json).toEqual({ url: "https://x.example", secret: "whsec_actual" });
    expect(updateArgs).toHaveLength(0); // no escribe
  });

  it("API key inválida → 401", async () => {
    apiKeyProvider = null;
    const { status, json } = await get();
    expect(status).toBe(401);
    expect(json.error.code).toBe("INVALID_API_KEY");
  });
});
