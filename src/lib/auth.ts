import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET es obligatorio en producción");
}

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

// --- Invite (token para unirse a la sala multijugador de un juego) ---

export type InvitePayload = {
  npub: string;
  pubkey: string;
  gameId: string;
  slug: string;
  roomId: string;
  host: boolean;
};

export async function signInvite(payload: InvitePayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "invite" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret);
}

export async function verifyInvite(
  token: string,
): Promise<InvitePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "invite") return null;
    return {
      npub: payload.npub as string,
      pubkey: payload.pubkey as string,
      gameId: payload.gameId as string,
      slug: payload.slug as string,
      roomId: payload.roomId as string,
      host: payload.host as boolean,
    };
  } catch {
    return null;
  }
}

// --- Bet-session (token Bearer para el modal de apuestas embebido) ---

export type BetSession = { sub: string; npub: string; pubkey: string };

export async function signBetSession(p: BetSession): Promise<string> {
  return new SignJWT({ ...p, purpose: "bet-session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

export async function verifyBetSession(
  token: string,
): Promise<BetSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "bet-session") return null;
    return {
      sub: payload.sub as string,
      npub: payload.npub as string,
      pubkey: payload.pubkey as string,
    };
  } catch {
    return null;
  }
}

// --- Withdraw token (LNURL-withdraw del ganador sin destino) ---

export async function signWithdrawToken(
  participantId: string,
  expEpochSeconds: number,
): Promise<string> {
  return new SignJWT({ pid: participantId, purpose: "withdraw" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expEpochSeconds)
    .sign(secret);
}

export async function verifyWithdrawToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "withdraw") return null;
    return payload.pid as string;
  } catch {
    return null;
  }
}
