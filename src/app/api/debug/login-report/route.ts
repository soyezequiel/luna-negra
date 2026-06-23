import { NextResponse } from "next/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

// Reporte de fallos del login NIP-46 (Nostr Connect) a un canal de Discord.
// El navegador NO conoce la URL del webhook (la tendría cualquiera y la
// spamearía): el cliente manda las líneas de diagnóstico acá y el server las
// reenvía a Discord usando `DISCORD_LOGIN_WEBHOOK_URL`. Si la env var no está
// configurada, el endpoint no hace nada (útil en dev).
export async function POST(req: Request) {
  const webhook = process.env.DISCORD_LOGIN_WEBHOOK_URL;
  // Sin webhook configurado: aceptamos en silencio para no romper el cliente.
  if (!webhook) return NextResponse.json({ ok: true, skipped: true });

  // Tope por IP: que un cliente roto (o malicioso) no inunde el canal.
  const rl = await checkRateLimit(`login-report:${clientIp(req)}`, 10, 600_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = await req.json().catch(() => ({}));
  const lines: string[] = Array.isArray(body.lines)
    ? body.lines.filter((l: unknown) => typeof l === "string").slice(0, 40)
    : [];
  const error = typeof body.error === "string" ? body.error.slice(0, 500) : "";
  const ua = typeof body.ua === "string" ? body.ua.slice(0, 300) : "";

  if (!error && lines.length === 0) {
    return NextResponse.json({ error: "nada para reportar" }, { status: 400 });
  }

  // Mensaje plano (Discord corta en 2000 chars). Bloque de código con el
  // timeline + el error + el user-agent del dispositivo.
  const header = `🌙 **Falló un login (Nostr Connect)**`;
  const errBlock = error ? `\n**Error:** ${error}` : "";
  const uaBlock = ua ? `\n**UA:** ${ua}` : "";
  const log = lines.length ? "\n```\n" + lines.join("\n") + "\n```" : "";
  const content = (header + errBlock + uaBlock + log).slice(0, 1990);

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      console.error("[login-report] Discord respondió", res.status);
      return NextResponse.json({ error: "webhook failed" }, { status: 502 });
    }
  } catch (e) {
    console.error("[login-report] no se pudo avisar a Discord:", e);
    return NextResponse.json({ error: "webhook error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
