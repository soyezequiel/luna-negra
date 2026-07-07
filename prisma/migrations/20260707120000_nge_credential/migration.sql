-- CreateTable
CREATE TABLE "NgeCredential" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "servicePubkey" TEXT NOT NULL,
    "serviceSecretEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "NgeCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NgeCredential_gameId_key" ON "NgeCredential"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "NgeCredential_servicePubkey_key" ON "NgeCredential"("servicePubkey");

-- AddForeignKey
ALTER TABLE "NgeCredential" ADD CONSTRAINT "NgeCredential_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
