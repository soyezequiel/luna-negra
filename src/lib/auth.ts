import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
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
  return new SignJWT({ ...payload, purpose: "session" })
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
    // El claim `purpose` separa la cookie de sesión de otros tokens firmados con
    // el mismo secreto (challenge/email-magic/bet-session/withdraw) y evita que se
    // usen como sesión. Transición: las cookies emitidas antes de este cambio no
    // lo traen, así que también se aceptan ausentes; endurecer a estricto cuando
    // hayan caducado (30 días).
    if (payload.purpose !== undefined && payload.purpose !== "session") {
      return null;
    }
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

// --- Magic link de email (token corto que liga un email verificado) ---

export async function signMagicLink(email: string): Promise<string> {
  return new SignJWT({ email, purpose: "email-magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID()) // identificador único → consumo de un solo uso
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyMagicLink(
  token: string,
): Promise<{ email: string; jti: string; expiresAt: Date } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "email-magic") return null;
    if (typeof payload.jti !== "string") return null;
    return {
      email: payload.email as string,
      jti: payload.jti,
      expiresAt:
        typeof payload.exp === "number"
          ? new Date(payload.exp * 1000)
          : new Date(Date.now() + 15 * 60_000),
    };
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

// Motivo legible de un rechazo de entitlement, para que el juego lo muestre en su puerta
// de login en vez de un 401 mudo. `code` es estable (apto para clientes); `message` humano.
export type EntitlementFailure = { code: string; message: string };

// Traduce el `code` de jose a un motivo accionable. Los códigos relevantes:
//   ERR_JWT_EXPIRED                      → el token venció (exp 5m): reabrir desde Luna.
//   ERR_JWS_SIGNATURE_VERIFICATION_FAILED→ firmado con otra LN_SIGNING_JWK: el juego apunta
//                                          a otra instancia de Luna que no minteó el token.
//   ERR_JWT_CLAIM_VALIDATION_FAILED      → iss/aud no coinciden.
function describeEntitlementError(e: unknown): EntitlementFailure {
  const code =
    (e as { code?: string })?.code ?? (e as { name?: string })?.name ?? "UNKNOWN";
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return {
        code,
        message:
          "El token de acceso venció (dura 5 minutos). Reabrí el juego desde Luna Negra.",
      };
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return {
        code,
        message:
          "La firma del token no coincide: el juego podría estar apuntando a otra instancia de Luna Negra (revisar LUNA_NEGRA_BASE_URL).",
      };
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      return {
        code,
        message: "El emisor o la audiencia del token no coinciden.",
      };
    default:
      return { code, message: "Token inválido o expirado." };
  }
}

// Variante que SÍ devuelve el motivo del rechazo (la ruta lo manda al cliente). El log queda
// acá: es lo único que distingue "token viejo" de "deploy mal apuntado" en los logs del server.
export async function verifyEntitlementDetailed(
  token: string,
): Promise<
  | { ok: true; payload: EntitlementPayload }
  | { ok: false; error: EntitlementFailure }
> {
  try {
    const { publicKey } = await getSigningKeys();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (payload.scope !== "entitlement") {
      console.warn("[auth] verifyEntitlement rechazó: scope inválido", {
        scope: payload.scope,
      });
      return {
        ok: false,
        error: { code: "INVALID_SCOPE", message: "El token no es un entitlement de juego." },
      };
    }
    return {
      ok: true,
      payload: {
        npub: payload.npub as string,
        pubkey: payload.pubkey as string,
        gameId: payload.gameId as string,
        slug: payload.slug as string,
      },
    };
  } catch (e) {
    const error = describeEntitlementError(e);
    console.warn("[auth] verifyEntitlement rechazó el token", {
      code: error.code,
      message: (e as { message?: string })?.message,
    });
    return { ok: false, error };
  }
}

export async function verifyEntitlement(
  token: string,
): Promise<EntitlementPayload | null> {
  const result = await verifyEntitlementDetailed(token);
  return result.ok ? result.payload : null;
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
  // El token identifica un retiro concreto hasta su deadline. No agregamos `iat`:
  // si el GET de la apuesta se consulta varias veces debe devolver exactamente el
  // mismo LNURL. Un token distinto en cada poll hace que los clientes regeneren el
  // QR continuamente y el usuario lo vea desaparecer/reaparecer al intentar cobrar.
  return new SignJWT({ pid: participantId, purpose: "withdraw" })
    .setProtectedHeader({ alg: "HS256" })
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
