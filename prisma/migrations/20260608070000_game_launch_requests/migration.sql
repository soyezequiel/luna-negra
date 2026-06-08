-- CreateTable
CREATE TABLE "GameLaunchRequest" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "gameUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "GameLaunchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameLaunchListener" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameLaunchListener_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameLaunchRequest_providerId_npub_expiresAt_idx" ON "GameLaunchRequest"("providerId", "npub", "expiresAt");

-- CreateIndex
CREATE INDEX "GameLaunchRequest_expiresAt_idx" ON "GameLaunchRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameLaunchListener_providerId_npub_key" ON "GameLaunchListener"("providerId", "npub");

-- CreateIndex
CREATE INDEX "GameLaunchListener_expiresAt_idx" ON "GameLaunchListener"("expiresAt");

-- AddForeignKey
ALTER TABLE "GameLaunchRequest" ADD CONSTRAINT "GameLaunchRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLaunchListener" ADD CONSTRAINT "GameLaunchListener_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
