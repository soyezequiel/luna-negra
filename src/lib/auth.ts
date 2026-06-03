import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
);

export const SESSION_COOKIE = "ln_session";

export type SessionPayload = {
  sub: string; // user id
  npub: string;
  pubkey: string;
};

// --- Sesión (cookie httpOnly, larga) ---

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      sub: payload.sub as string,
      npub: payload.npub as string,
      pubkey: payload.pubkey as string,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

// --- Challenge (token corto que liga pubkey + nonce, sin estado en DB) ---

export async function signChallenge(
  pubkey: string,
  nonce: string,
): Promise<string> {
  return new SignJWT({ pubkey, nonce, purpose: "challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyChallenge(
  token: string,
): Promise<{ pubkey: string; nonce: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "challenge") return null;
    return { pubkey: payload.pubkey as string, nonce: payload.nonce as string };
  } catch {
    return null;
  }
}

// --- Entitlement (token corto para que el juego verifique el acceso) ---

export type EntitlementPayload = {
  npub: string;
  pubkey: string;
  gameId: string;
  slug: string;
};

export async function signEntitlement(
  payload: EntitlementPayload,
): Promise<string> {
  return new SignJWT({ ...payload, purpose: "entitlement" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyEntitlement(
  token: string,
): Promise<EntitlementPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "entitlement") return null;
    return {
      npub: payload.npub as string,
      pubkey: payload.pubkey as string,
      gameId: payload.gameId as string,
      slug: payload.slug as string,
    };
  } catch {
    return null;
  }
}
