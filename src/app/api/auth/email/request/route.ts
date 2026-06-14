import { NextResponse } from "next/server";
import { signMagicLink } from "@/lib/auth";
import { sendMagicLink, isEmailLoginEnabled } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Paso 1 del login por email: el usuario manda su correo y le enviamos un link
// mágico (token JWT de 15 min). NO revelamos si el email ya tiene cuenta: siempre
// respondemos ok, así no se puede sondear qué correos están registrados.
export async function POST(req: Request) {
  if (!isEmailLoginEnabled()) {
    return NextResponse.json(
      { error: "El login por email no está disponible" },
      { status: 404 },
    );
  }

  const rl = await checkRateLimit(`email-req:${clientIp(req)}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos. Probá de nuevo en un minuto." },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { email } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  const normalized = email.trim().toLowerCase().slice(0, 255);

  // Tope por destinatario: que nadie use el endpoint para spamear un buzón ajeno.
  const rlTo = await checkRateLimit(`email-req-to:${normalized}`, 3, 600_000);
  if (!rlTo.success) {
    return NextResponse.json(
      { error: "Ya enviamos varios links a ese correo. Revisá tu bandeja." },
      { status: 429, headers: rateLimitHeaders(rlTo) },
    );
  }

  const token = await signMagicLink(normalized);
  const url = `${siteUrl(req)}/auth/email?token=${encodeURIComponent(token)}`;

  try {
    await sendMagicLink(normalized, url);
  } catch (e) {
    console.error("[email] envío fallido:", e);
    return NextResponse.json(
      { error: "No se pudo enviar el email. Probá de nuevo." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
