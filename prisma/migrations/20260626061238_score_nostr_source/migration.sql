-- AlterTable
ALTER TABLE "Score" ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "sourcePubkey" TEXT;

-- CreateIndex
CREATE INDEX "Score_sourceEventId_idx" ON "Score"("sourceEventId");
