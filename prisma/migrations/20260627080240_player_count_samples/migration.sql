-- CreateTable
CREATE TABLE "PlayerCountSample" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerCountSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerCountSample_providerId_sampledAt_idx" ON "PlayerCountSample"("providerId", "sampledAt");

-- AddForeignKey
ALTER TABLE "PlayerCountSample" ADD CONSTRAINT "PlayerCountSample_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
