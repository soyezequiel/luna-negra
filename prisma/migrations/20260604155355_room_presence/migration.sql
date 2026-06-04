-- CreateTable
CREATE TABLE "RoomPresence" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "host" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomPresence_roomId_idx" ON "RoomPresence"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPresence_roomId_clientId_key" ON "RoomPresence"("roomId", "clientId");
