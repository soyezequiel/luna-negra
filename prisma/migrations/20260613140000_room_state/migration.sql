-- CreateTable
CREATE TABLE "RoomState" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMemberState" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomMemberState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomState_roomId_key" ON "RoomState"("roomId");

-- CreateIndex
CREATE INDEX "RoomState_expiresAt_idx" ON "RoomState"("expiresAt");

-- CreateIndex
CREATE INDEX "RoomMemberState_roomId_idx" ON "RoomMemberState"("roomId");

-- CreateIndex
CREATE INDEX "RoomMemberState_expiresAt_idx" ON "RoomMemberState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMemberState_roomId_npub_key" ON "RoomMemberState"("roomId", "npub");
