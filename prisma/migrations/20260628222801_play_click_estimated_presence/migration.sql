-- AlterTable
ALTER TABLE "PlayerCountSample" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'presence';

-- CreateTable
CREATE TABLE "GamePlayClick" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamePlayClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GamePlayClick_providerId_expiresAt_idx" ON "GamePlayClick"("providerId", "expiresAt");

-- CreateIndex
CREATE INDEX "GamePlayClick_expiresAt_idx" ON "GamePlayClick"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePlayClick_gameId_npub_key" ON "GamePlayClick"("gameId", "npub");

-- AddForeignKey
ALTER TABLE "GamePlayClick" ADD CONSTRAINT "GamePlayClick_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
