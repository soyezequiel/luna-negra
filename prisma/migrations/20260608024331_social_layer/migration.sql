-- CreateTable
CREATE TABLE "GamePresence" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "roomId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamePresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameInvite" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "fromNpub" TEXT NOT NULL,
    "toNpub" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inviteUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "GameInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GamePresence_providerId_idx" ON "GamePresence"("providerId");

-- CreateIndex
CREATE INDEX "GamePresence_expiresAt_idx" ON "GamePresence"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePresence_providerId_npub_key" ON "GamePresence"("providerId", "npub");

-- CreateIndex
CREATE INDEX "GameInvite_toNpub_expiresAt_idx" ON "GameInvite"("toNpub", "expiresAt");

-- AddForeignKey
ALTER TABLE "GamePresence" ADD CONSTRAINT "GamePresence_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
