import { NextResponse } from "next/server";
import { verifyEvent, nip19, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, signSession, verifyChallenge } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const AUTH_KIND = 27235; // NIP-98 (HTTP Auth event)
const MAX_AGE_SECONDS = 300;

export async function POST(req: Request) {
  if (!rateLimit(`verify:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }
  const { token, event } = await req.json().catch(() => ({}));

  const challenge = await verifyChallenge(token);
  if (!challenge) {
    return NextResponse.json(
      { error: "Challenge inválido o expirado" },
      { status: 401 },
    );
  }

  const ev = event as Event;
  if (!ev || ev.kind !== AUTH_KIND || ev.pubkey !== challenge.pubkey) {
    return NextResponse.json({ error: "Evento inválido" }, { status: 401 });
  }

  const nonceTag = ev.tags?.find((t) => t[0] === "challenge")?.[1];
  if (nonceTag !== challenge.nonce) {
    return NextResponse.json({ error: "El nonce no coincide" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ev.created_at) > MAX_AGE_SECONDS) {
    return NextResponse.json({ error: "Evento expirado" }, { status: 401 });
  }

  if (!verifyEvent(ev)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  const npub = nip19.npubEncode(ev.pubkey);
  const user = await prisma.user.upsert({
    where: { pubkey: ev.pubkey },
    update: { lastSeen: new Date() },
    create: { pubkey: ev.pubkey, npub },
  });

  const session = await signSession({
    sub: user.id,
    npub: user.npub,
    pubkey: user.pubkey,
  });

  const res = NextResponse.json({
    user: { id: user.id, npub: user.npub, pubkey: user.pubkey },
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
