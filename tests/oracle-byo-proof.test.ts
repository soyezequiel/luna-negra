import { describe, it, expect, beforeAll } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  validateOracleProof,
  oracleProofContent,
  validateAttestationOracleProof,
  attestationOracleProofContent,
  ORACLE_PROOF_MAX_AGE_S,
} from "@/lib/oracle-keys";

// Prueba de posesión de una clave de oráculo BYO (Slice 2, keyless). El proveedor
// firma un evento con SU clave; Luna verifica firma + reto ligado al proveedor +
// frescura antes de declararla. crypto-vault necesita ORACLE_ENC_KEY aunque acá no
// ciframos nada (import transitivo).
beforeAll(() => {
  process.env.ORACLE_ENC_KEY = "0".repeat(64);
});

const PROVIDER = "prov_abc123";
const NOW = 1_800_000_000;

function signProof(sk: Uint8Array, opts: { content?: string; created_at?: number } = {}) {
  return finalizeEvent(
    {
      kind: 27235,
      created_at: opts.created_at ?? NOW,
      tags: [],
      content: opts.content ?? oracleProofContent(PROVIDER),
    },
    sk,
  );
}

describe("validateOracleProof", () => {
  it("evento firmado con el reto correcto y fresco → declara la pubkey firmante", () => {
    const sk = generateSecretKey();
    const proof = signProof(sk);
    const res = validateOracleProof(PROVIDER, proof, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.oraclePubkey).toBe(getPublicKey(sk));
  });

  it("content que no es el reto de ESTE proveedor → WRONG_CHALLENGE", () => {
    const sk = generateSecretKey();
    const proof = signProof(sk, { content: oracleProofContent("otro_provider") });
    const res = validateOracleProof(PROVIDER, proof, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("WRONG_CHALLENGE");
  });

  it("prueba vieja fuera de la ventana → STALE", () => {
    const sk = generateSecretKey();
    const proof = signProof(sk, { created_at: NOW - ORACLE_PROOF_MAX_AGE_S - 1 });
    const res = validateOracleProof(PROVIDER, proof, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("STALE");
  });

  it("firma manipulada (content cambiado tras firmar) → BAD_SIGNATURE", () => {
    const sk = generateSecretKey();
    const proof = signProof(sk);
    const tampered = { ...proof, content: oracleProofContent(PROVIDER) + "x" };
    const res = validateOracleProof(PROVIDER, tampered, NOW);
    expect(res.ok).toBe(false);
    // content cambiado invalida la firma antes de llegar al chequeo de reto
    if (!res.ok) expect(res.code).toBe("BAD_SIGNATURE");
  });

  it("objeto sin forma de evento → BAD_PROOF", () => {
    // @ts-expect-error probamos entrada inválida a propósito
    const res = validateOracleProof(PROVIDER, { foo: 1 }, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("BAD_PROOF");
  });
});

// Prueba de posesión del oráculo de ATESTACIONES (NGP kind:31338): mismo núcleo
// que la BYO pero ligada al JUEGO (no al proveedor) — los retos no son
// intercambiables entre sí ni entre juegos.
describe("validateAttestationOracleProof", () => {
  const GAME = "game_xyz789";

  function signGameProof(sk: Uint8Array, opts: { content?: string; created_at?: number } = {}) {
    return finalizeEvent(
      {
        kind: 27235,
        created_at: opts.created_at ?? NOW,
        tags: [],
        content: opts.content ?? attestationOracleProofContent(GAME),
      },
      sk,
    );
  }

  it("reto del juego correcto y fresco → declara la pubkey firmante", () => {
    const sk = generateSecretKey();
    const res = validateAttestationOracleProof(GAME, signGameProof(sk), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.oraclePubkey).toBe(getPublicKey(sk));
  });

  it("reto de OTRO juego → WRONG_CHALLENGE (anti-replay entre juegos)", () => {
    const sk = generateSecretKey();
    const proof = signGameProof(sk, { content: attestationOracleProofContent("otro_juego") });
    const res = validateAttestationOracleProof(GAME, proof, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("WRONG_CHALLENGE");
  });

  it("el reto BYO del proveedor NO sirve para atestaciones (propósitos separados)", () => {
    const sk = generateSecretKey();
    const proof = signGameProof(sk, { content: oracleProofContent(PROVIDER) });
    const res = validateAttestationOracleProof(GAME, proof, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("WRONG_CHALLENGE");
  });

  it("prueba vieja → STALE", () => {
    const sk = generateSecretKey();
    const proof = signGameProof(sk, { created_at: NOW - ORACLE_PROOF_MAX_AGE_S - 1 });
    const res = validateAttestationOracleProof(GAME, proof, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("STALE");
  });
});
