import { generateKeyPair, exportJWK, importJWK, type JWK } from "jose";

// Claves de firma asimétrica (ES256) para los tokens orientados a devs
// (entitlement, invite). El game server los valida OFFLINE con la clave pública
// publicada en /.well-known/jwks.json — no necesita llamar a Luna Negra.
//
// Prod: definir LN_SIGNING_JWK (JWK privada ES256). Dev: se genera un par
// efímero por proceso (los tokens son cortos; no sobreviven reinicios).

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

type SigningKeys = {
  privateKey: KeyPair["privateKey"];
  publicKey: KeyPair["publicKey"];
  publicJwk: JWK;
  kid: string;
};

const isProd = process.env.NODE_ENV === "production";

let cache: Promise<SigningKeys> | null = null;

async function build(): Promise<SigningKeys> {
  const envJwk = process.env.LN_SIGNING_JWK;

  if (envJwk) {
    const jwk = JSON.parse(envJwk) as JWK;
    const kid = jwk.kid ?? "ln-1";
    const privateKey = (await importJWK(
      { ...jwk, alg: "ES256" },
      "ES256",
    )) as KeyPair["privateKey"];
    // Clave pública = la JWK sin el campo privado `d`.
    const { d: _d, ...pub } = jwk;
    void _d;
    const publicJwk: JWK = { ...pub, kid, alg: "ES256", use: "sig" };
    const publicKey = (await importJWK(
      publicJwk,
      "ES256",
    )) as KeyPair["publicKey"];
    return { privateKey, publicKey, publicJwk, kid };
  }

  if (isProd) {
    throw new Error(
      "LN_SIGNING_JWK es obligatorio en producción (clave ES256 para firmar los tokens de dev)",
    );
  }

  // Dev: par efímero.
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const pub = await exportJWK(publicKey);
  const kid = "ln-dev";
  const publicJwk: JWK = { ...pub, kid, alg: "ES256", use: "sig" };
  return { privateKey, publicKey, publicJwk, kid };
}

export function getSigningKeys(): Promise<SigningKeys> {
  if (!cache) cache = build();
  return cache;
}

/** Documento JWKS público (lo que ve el game server). */
export async function getJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getSigningKeys();
  return { keys: [publicJwk] };
}

// Issuer/audience estándar de los tokens de dev.
export const TOKEN_ISSUER = process.env.LN_ISSUER ?? "luna-negra";
export const TOKEN_AUDIENCE = "lunanegra:game";
