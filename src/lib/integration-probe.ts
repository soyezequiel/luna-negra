import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { signEntitlement, signInvite } from "@/lib/auth";
import { signWebhook } from "@/lib/webhooks";
import type { IntegrationFeature } from "@/lib/integration-features";

// Probador en vivo: golpea los endpoints reales del contrato público para
// verificar que responden bien AHORA (health-check), distinto de la telemetría
// observada (que dice si el JUEGO los usa). Corre 100% en el servidor: mintea
// tokens de prueba y nunca expone la API key.
//
// - sso/purchase/rooms/leaderboards: camino feliz completo con un token de prueba
//   (read-only, sin efectos: no crea marcadores ni salas).
// - presence/social/bets: chequeo de alcance — el endpoint debe responder 401
//   INVALID_API_KEY (probar el camino feliz exigiría una API key real y tendría
//   efectos: crear apuestas, mandar invitaciones).
// - webhooks: si el proveedor configuró una URL, le manda un evento `ping` firmado
//   y reporta el status que devuelve su server.

export type ProbeResult = {
  feature: IntegrationFeature;
  ok: boolean;
  status: number | null; // status HTTP observado (null si se omitió)
  latencyMs: number | null;
  detail: string;
  skipped: boolean;
};

// Identidad de prueba determinística (no es de ningún usuario real). El session
// endpoint la busca en la DB, no la encuentra y devuelve nombre/avatar null: el
// 200 igual confirma que el canje de token funciona.
const PROBE_PUBKEY =
  "0000000000000000000000000000000000000000000000000000000000000001";

async function timedFetch(
  url: string,
  init: RequestInit,
): Promise<{ status: number; latencyMs: number; body: unknown } | { error: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, latencyMs: Date.now() - started, body };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "error de red",
      latencyMs: Date.now() - started,
    };
  }
}

function errorCode(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (err && typeof err === "object" && "code" in err) {
      return String((err as { code?: unknown }).code ?? "");
    }
  }
  return null;
}

/** Espera un 401 INVALID_API_KEY: el endpoint está vivo y cierra la puerta bien. */
async function probeAuthGate(
  feature: IntegrationFeature,
  url: string,
  method: "GET" | "POST",
): Promise<ProbeResult> {
  const r = await timedFetch(url, { method });
  if ("error" in r) {
    return { feature, ok: false, status: null, latencyMs: r.latencyMs, detail: `No respondió: ${r.error}`, skipped: false };
  }
  const ok = r.status === 401 && errorCode(r.body) === "INVALID_API_KEY";
  return {
    feature,
    ok,
    status: r.status,
    latencyMs: r.latencyMs,
    detail: ok
      ? "Endpoint activo (exige API key, como se espera)."
      : `Respuesta inesperada (status ${r.status}); se esperaba 401 INVALID_API_KEY.`,
    skipped: false,
  };
}

const skip = (feature: IntegrationFeature, detail: string): ProbeResult => ({
  feature,
  ok: false,
  status: null,
  latencyMs: null,
  detail,
  skipped: true,
});

export async function runProbe(opts: {
  providerId: string;
  origin: string;
}): Promise<ProbeResult[]> {
  const { providerId, origin } = opts;
  const base = `${origin.replace(/\/$/, "")}/api/v1`;
  const npub = nip19.npubEncode(PROBE_PUBKEY);

  const [game, provider] = await Promise.all([
    prisma.game.findFirst({
      where: { providerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, slug: true },
    }),
    prisma.provider.findUnique({
      where: { id: providerId },
      select: { webhookUrl: true, webhookSecret: true },
    }),
  ]);

  const results: ProbeResult[] = [];

  // ── Endpoints con token de prueba (camino feliz, sin efectos) ──
  if (game) {
    const ent = await signEntitlement({ npub, pubkey: PROBE_PUBKEY, gameId: game.id, slug: game.slug });
    const invite = await signInvite({
      npub,
      pubkey: PROBE_PUBKEY,
      gameId: game.id,
      slug: game.slug,
      roomId: "probe-room",
      host: true,
      hostNpub: npub,
      hostPubkey: PROBE_PUBKEY,
    });
    const authEnt = { headers: { authorization: `Bearer ${ent}` } };

    // §1 SSO
    {
      const r = await timedFetch(`${base}/session`, { method: "GET", ...authEnt });
      const ok = !("error" in r) && r.status === 200 && !!(r.body as { npub?: unknown })?.npub;
      results.push({
        feature: "sso",
        ok,
        status: "error" in r ? null : r.status,
        latencyMs: r.latencyMs,
        detail: ok ? "Canje de token OK: devuelve la identidad del jugador." : "No devolvió la identidad esperada.",
        skipped: false,
      });
    }
    // §2 Verificar compra
    {
      const r = await timedFetch(`${base}/entitlements/verify`, { method: "GET", ...authEnt });
      const ok = !("error" in r) && r.status === 200 && (r.body as { valid?: unknown })?.valid === true;
      results.push({
        feature: "purchase",
        ok,
        status: "error" in r ? null : r.status,
        latencyMs: r.latencyMs,
        detail: ok ? "Introspección de acceso OK (valid: true)." : "No validó el token de prueba.",
        skipped: false,
      });
    }
    // §4 Salas
    {
      const r = await timedFetch(`${base}/rooms/verify`, {
        method: "GET",
        headers: { authorization: `Bearer ${invite}` },
      });
      const ok = !("error" in r) && r.status === 200 && (r.body as { valid?: unknown })?.valid === true;
      results.push({
        feature: "rooms",
        ok,
        status: "error" in r ? null : r.status,
        latencyMs: r.latencyMs,
        detail: ok ? "Introspección de invite OK (valid: true)." : "No validó el invite token de prueba.",
        skipped: false,
      });
    }
    // §6 Marcadores (lectura, no crea nada)
    {
      const r = await timedFetch(`${base}/leaderboards/__probe__?window=all`, { method: "GET", ...authEnt });
      const ok = !("error" in r) && r.status === 200 && Array.isArray((r.body as { entries?: unknown })?.entries);
      results.push({
        feature: "leaderboards",
        ok,
        status: "error" in r ? null : r.status,
        latencyMs: r.latencyMs,
        detail: ok ? "Lectura de marcador OK." : "No devolvió la lista de entradas.",
        skipped: false,
      });
    }
  } else {
    for (const f of ["sso", "purchase", "rooms", "leaderboards"] as IntegrationFeature[]) {
      results.push(skip(f, "Creá un juego para poder probar este endpoint."));
    }
  }

  // ── Endpoints con API key: chequeo de alcance (deben exigir API key) ──
  results.push(await probeAuthGate("presence", `${base}/presence`, "POST"));
  results.push(await probeAuthGate("social", `${base}/friends`, "GET"));
  results.push(await probeAuthGate("bets", `${base}/bets`, "POST"));

  // ── §8 Webhooks: ping firmado a la URL del proveedor ──
  if (!provider?.webhookUrl || !provider.webhookSecret) {
    results.push(skip("webhooks", "No hay URL de webhook configurada."));
  } else {
    const payload = {
      id: `probe_${Date.now()}`,
      type: "ping",
      created: new Date().toISOString(),
      data: { message: "Ping de prueba del panel de integración de Luna Negra." },
    };
    const body = JSON.stringify(payload);
    const r = await timedFetch(provider.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LunaNegra-Event": "ping",
        "X-LunaNegra-Signature": signWebhook(body, provider.webhookSecret),
      },
      body,
    });
    if ("error" in r) {
      results.push({ feature: "webhooks", ok: false, status: null, latencyMs: r.latencyMs, detail: `Tu server no respondió: ${r.error}`, skipped: false });
    } else {
      const ok = r.status >= 200 && r.status < 300;
      results.push({
        feature: "webhooks",
        ok,
        status: r.status,
        latencyMs: r.latencyMs,
        detail: ok ? `Tu server respondió ${r.status} al ping firmado.` : `Tu server respondió ${r.status} (se esperaba 2xx).`,
        skipped: false,
      });
    }
  }

  return results;
}
