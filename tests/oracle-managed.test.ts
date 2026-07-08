import { describe, it, expect } from "vitest";
import { needsManagedOracle } from "@/lib/oracle-keys";

// El guard de emisión de credencial NGE v2 (issueNgeCredential → ensureManagedOracle)
// decide con `needsManagedOracle`: NGE v2 firma el resultado server-side, así que el
// proveedor DEBE tener oráculo GESTIONADO (Luna custodia el secreto). Un proveedor sin
// oráculo o BYO/self-signed hay que convertirlo; uno ya gestionado se deja intacto.
describe("needsManagedOracle", () => {
  it("false para un proveedor YA gestionado (secreto custodiado, no self-signed)", () => {
    expect(needsManagedOracle({ oracleSecretEnc: "v1:iv:tag:ct", oracleSelfSigned: false })).toBe(false);
  });

  it("true si no tiene oráculo (sin secreto custodiado)", () => {
    expect(needsManagedOracle({ oracleSecretEnc: null, oracleSelfSigned: false })).toBe(true);
  });

  it("true si es BYO/self-signed (Luna no custodia el secreto)", () => {
    expect(needsManagedOracle({ oracleSecretEnc: null, oracleSelfSigned: true })).toBe(true);
  });

  it("true incluso con secreto presente si quedó marcado self-signed (BYO manda)", () => {
    // Estado inconsistente (no debería pasar), pero el guard prioriza convertir a
    // gestionado antes que confiar en un secreto de un proveedor marcado BYO.
    expect(needsManagedOracle({ oracleSecretEnc: "v1:iv:tag:ct", oracleSelfSigned: true })).toBe(true);
  });
});
