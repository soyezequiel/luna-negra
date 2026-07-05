-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "gameId" TEXT;

-- CreateIndex
CREATE INDEX "ApiKey_gameId_idx" ON "ApiKey"("gameId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
