-- AlterTable: clave del oráculo gestionado por proveedor.
ALTER TABLE "Provider" ADD COLUMN "oraclePubkey" TEXT;
ALTER TABLE "Provider" ADD COLUMN "oracleSecretEnc" TEXT;

-- Backfill de claves de oráculo: NO se hace en SQL (requiere generar keypairs
-- Nostr y cifrarlos con ORACLE_ENC_KEY). Ejecutar después del migrate:
--   node prisma/scripts/backfill-oracle-keys.mjs
-- Genera una clave gestionada para cada proveedor existente (oraclePubkey +
-- oracleSecretEnc), de modo que el camino con API key funcione para todos.
