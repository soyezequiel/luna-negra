-- AlterTable: login por email (cuentas custodiales). `email` es el identificador
-- de login; `nsecEnc` guarda la clave privada Nostr cifrada (AES-256-GCM). Ambas
-- son null en cuentas Nostr normales.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "nsecEnc" TEXT;

-- Índice único de email. Al ser nullable, Postgres permite múltiples NULL, así
-- que las cuentas Nostr (sin email) no chocan entre sí.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
