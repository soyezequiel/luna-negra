-- CreateTable
CREATE TABLE "StorePresence" (
    "pubkey" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePresence_pkey" PRIMARY KEY ("pubkey")
);

-- CreateTable
CREATE TABLE "StorePresenceSample" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "npubs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePresenceSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorePresence_expiresAt_idx" ON "StorePresence"("expiresAt");

-- CreateIndex
CREATE INDEX "StorePresenceSample_sampledAt_idx" ON "StorePresenceSample"("sampledAt");
