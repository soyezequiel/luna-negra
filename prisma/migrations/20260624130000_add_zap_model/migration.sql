-- AlterTable
ALTER TABLE "Game" ADD COLUMN "zapLnurlPubkey" TEXT;

-- CreateTable
CREATE TABLE "Zap" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "zapperPubkey" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "comment" TEXT,
    "zappedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Zap_receiptId_key" ON "Zap"("receiptId");

-- CreateIndex
CREATE INDEX "Zap_gameId_idx" ON "Zap"("gameId");

-- CreateIndex
CREATE INDEX "Zap_providerId_idx" ON "Zap"("providerId");

-- CreateIndex
CREATE INDEX "Zap_zapperPubkey_idx" ON "Zap"("zapperPubkey");

-- AddForeignKey
ALTER TABLE "Zap" ADD CONSTRAINT "Zap_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
