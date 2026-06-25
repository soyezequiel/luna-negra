-- Caché de comentarios (kind:1) traídos de Nostr. La fuente de verdad sigue
-- siendo el evento Nostr; esta tabla solo acelera el acceso (centro de
-- notificaciones), igual que `Zap` cachea los recibos 9735. Dedup por eventId.
CREATE TABLE "GameComment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "authorPubkey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameComment_eventId_key" ON "GameComment"("eventId");
CREATE INDEX "GameComment_gameId_idx" ON "GameComment"("gameId");
CREATE INDEX "GameComment_authorPubkey_idx" ON "GameComment"("authorPubkey");

ALTER TABLE "GameComment" ADD CONSTRAINT "GameComment_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
