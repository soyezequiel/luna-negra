-- Presencia por juego: hasta ahora la presencia (y por ende la curva de jugadores
-- concurrentes) era SOLO por proveedor, porque el heartbeat no decía a qué juego
-- pertenecía → dos juegos del mismo proveedor mostraban la misma curva. Agregamos
-- `gameId` (nullable) a la presencia y a las muestras: el game server lo manda como
-- `game` en POST /api/v1/presence. null = legacy/provider-wide (compatibilidad).

-- AlterTable
ALTER TABLE "GamePresence" ADD COLUMN "gameId" TEXT;
ALTER TABLE "PlayerCountSample" ADD COLUMN "gameId" TEXT;

-- CreateIndex
CREATE INDEX "GamePresence_providerId_gameId_expiresAt_idx" ON "GamePresence"("providerId", "gameId", "expiresAt");
CREATE INDEX "PlayerCountSample_providerId_gameId_sampledAt_idx" ON "PlayerCountSample"("providerId", "gameId", "sampledAt");
