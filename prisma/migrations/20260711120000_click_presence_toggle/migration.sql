-- AlterTable: interruptor de admin para la presencia "optimista" al abrir un
-- juego. true (default) = comportamiento actual; false = solo queda la presencia
-- NIP-38 que firma el propio juego.
ALTER TABLE "PlatformSettings" ADD COLUMN "clickPresenceEnabled" BOOLEAN NOT NULL DEFAULT true;
