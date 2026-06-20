import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";

// Identidad de INVITADO para jugar juegos GRATIS sin cuenta Nostr. Es un keypair
// efímero (la privada se descarta: el invitado nunca firma nada) guardado en una
// cookie httpOnly firmada para que el mismo navegador conserve la misma identidad
// entre partidas — así el juego puede persistir progreso por npub. A diferencia de
// los usuarios invitados de apuestas (`guest-users.ts`) NO se persiste en la DB:
// el entitlement se verifica offline por JWKS y no necesita un registro de usuario.

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
);

export const GUEST_COOKIE = "ln_guest";

export type GuestIdentity = { npub: string; pubkey: string };

export const guestCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1 año
};

/** Genera una identidad de invitado nueva (keypair aleatorio, sin persistir). */
export function newGuestIdentity(): GuestIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { pubkey, npub: nip19.npubEncode(pubkey) };
}

/** Lee la identidad de invitado de la cookie firmada, o null si no hay/expiró. */
export async function readGuestIdentity(): Promise<GuestIdentity | null> {
  const store = await cookies();
  const token = store.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "guest") return null;
    return { npub: payload.npub as string, pubkey: payload.pubkey as string };
  } catch {
    return null;
  }
}

/** Valor firmado para la cookie `GUEST_COOKIE` que persiste la identidad. */
export async function guestCookieValue(identity: GuestIdentity): Promise<string> {
  return new SignJWT({ ...identity, purpose: "guest" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secret);
}
