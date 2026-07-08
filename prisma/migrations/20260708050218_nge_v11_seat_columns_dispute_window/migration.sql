-- AlterTable
ALTER TABLE "ZapBet" ADD COLUMN     "ngeClientRef" TEXT,
ADD COLUMN     "ngeUnlisted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingWinnersJson" TEXT,
ADD COLUMN     "settleAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ZapBetParticipant" ADD COLUMN     "ngeSeatId" TEXT;

-- CreateIndex
CREATE INDEX "ZapBet_settleAt_idx" ON "ZapBet"("settleAt");
