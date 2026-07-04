-- CreateTable
CREATE TABLE "PlaySession" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "gameId" TEXT,
    "npub" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PlaySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaySession_providerId_gameId_npub_endedAt_idx" ON "PlaySession"("providerId", "gameId", "npub", "endedAt");

-- CreateIndex
CREATE INDEX "PlaySession_gameId_npub_idx" ON "PlaySession"("gameId", "npub");

-- CreateIndex
CREATE INDEX "PlaySession_endedAt_idx" ON "PlaySession"("endedAt");

-- AddForeignKey
ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
