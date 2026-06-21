-- CreateTable
CREATE TABLE "IntegrationPing" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL DEFAULT '',
    "feature" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationPing_providerId_idx" ON "IntegrationPing"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationPing_providerId_gameId_feature_key" ON "IntegrationPing"("providerId", "gameId", "feature");

-- AddForeignKey
ALTER TABLE "IntegrationPing" ADD CONSTRAINT "IntegrationPing_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
