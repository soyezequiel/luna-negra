import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, signSession, verifyMagicLink } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { generateCustodialIdentity, decryptNsec } from "@/lib/custodial-keys";
import { isEmailLoginEnabled } from "@/lib/email";

// Paso 2 del login por email: el navegador canjea el token del magic link. Si el
// email no tiene cuenta, le generamos una identidad Nostr custodial (keypair que
// Luna Negra custodia cifrado). Devolvemos la nsec en claro para que el cliente
// arme su signer local; nunca se persiste sin cifrar.
export async function POST(req: Request) {
  if (!isEmailLoginEnabled()) {
    return NextResponse.json(
      { error: "El login por email no está disponible" },
      { status: 404 },
    );
  }

  const rl = await checkRateLimit(`email-verify:${clientIp(req)}`, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { token } = await req.json().catch(() => ({}));
  const magic = await verifyMagicLink(token);
  if (!magic) {
    return NextResponse.json(
      { error: "El link es inválido o expiró. Pedí uno nuevo." },
      { status: 401 },
    );
  }

  // Consumo de un solo uso: registramos el jti del link. Si ya estaba (replay
  // dentro de la ventana de 15 min) el unique constraint choca y lo rechazamos.
  try {
    await prisma.consumedMagicLink.create({
      data: { jti: magic.jti, expiresAt: magic.expiresAt },
    });
  } catch {
    return NextResponse.json(
      { error: "Este link ya fue usado. Pedí uno nuevo." },
      { status: 401 },
    );
  }

  // Crea-o-encuentra por email. upsert evita la carrera de dos clics simultáneos
  // creando la misma cuenta; el keypair generado solo se usa en el create.
  const fresh = generateCustodialIdentity();
  const user = await prisma.user.upsert({
    where: { email: magic.email },
    update: { lastSeen: new Date() },
    create: {
      email: magic.email,
      npub: fresh.npub,
      pubkey: fresh.pubkey,
      nsecEnc: fresh.nsecEnc,
    },
  });

  if (!user.nsecEnc) {
    // No debería pasar: un email siempre corresponde a una cuenta custodial.
    return NextResponse.json(
      { error: "Esta cuenta no admite login por email" },
      { status: 409 },
    );
  }
  const nsec = decryptNsec(user.nsecEnc);

  const session = await signSession({
    sub: user.id,
    npub: user.npub,
    pubkey: user.pubkey,
  });

  const res = NextResponse.json({
    user: {
      id: user.id,
      npub: user.npub,
      pubkey: user.pubkey,
      email: user.email,
      custodial: true,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
    nsec,
  });
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
