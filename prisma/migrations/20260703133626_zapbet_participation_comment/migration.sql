-- AlterTable
ALTER TABLE "ZapBetParticipant" ADD COLUMN     "commentEventId" TEXT,
ADD COLUMN     "commentEventJson" TEXT,
ADD COLUMN     "commentEventOk" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ZapBetParticipant_commentEventId_key" ON "ZapBetParticipant"("commentEventId");
