import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSigningKeys, TOKEN_ISSUER, TOKEN_AUDIENCE } from "@/lib/jwks";

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

// Firmado con ES256 (clave asimétrica) → el game server lo valida offline con la
// clave pública de /.well-known/jwks.json. Claims estándar: iss/aud/sub/exp/scope.
export async function signEntitlement(
  payload: EntitlementPayload,
): Promise<string> {
  const { privateKey, kid } = await getSigningKeys();
  return new SignJWT({
    npub: payload.npub,
    pubkey: payload.pubkey,
    gameId: payload.gameId,
    slug: payload.slug,
    scope: "entitlement",
  })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(payload.npub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export async function verifyEntitlement(
  token: string,
): Promise<EntitlementPayload | null> {
  try {
    const { publicKey } = await getSigningKeys();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (payload.scope !== "entitlement") return null;
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
  // Identidad Nostr del host original de la sala (para que los invitados sepan
  // quién la creó). Null en tokens viejos o salas sin Room registrada.
  hostNpub: string | null;
  hostPubkey: string | null;
};

// ES256 (asimétrica) → verificable offline vía JWKS, como el entitlement.
export async function signInvite(payload: InvitePayload): Promise<string> {
  const { privateKey, kid } = await getSigningKeys();
  return new SignJWT({
    npub: payload.npub,
    pubkey: payload.pubkey,
    gameId: payload.gameId,
    slug: payload.slug,
    roomId: payload.roomId,
    host: payload.host,
    hostNpub: payload.hostNpub,
    hostPubkey: payload.hostPubkey,
    scope: "invite",
  })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(payload.npub)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(privateKey);
}

// Lo que devuelve verifyInvite: el payload + `expiresAt` derivado del claim `exp`
// (para que el lobby muestre errores claros cuando la invitación caducó).
export type VerifiedInvite = InvitePayload & { expiresAt: string | null };

export async function verifyInvite(
  token: string,
): Promise<VerifiedInvite | null> {
  try {
    const { publicKey } = await getSigningKeys();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (payload.scope !== "invite") return null;
    return {
      npub: payload.npub as string,
      pubkey: payload.pubkey as string,
      gameId: payload.gameId as string,
      slug: payload.slug as string,
      roomId: payload.roomId as string,
      host: payload.host as boolean,
      hostNpub: (payload.hostNpub as string | undefined) ?? null,
      hostPubkey: (payload.hostPubkey as string | undefined) ?? null,
      expiresAt:
        typeof payload.exp === "number"
          ? new Date(payload.exp * 1000).toISOString()
          : null,
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
