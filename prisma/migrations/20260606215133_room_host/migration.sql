-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "hostNpub" TEXT NOT NULL,
    "hostPubkey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Room_gameId_idx" ON "Room"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_gameId_roomId_key" ON "Room"("gameId", "roomId");
