-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "stakeMsat" BIGINT NOT NULL,
    "feePct" INTEGER NOT NULL DEFAULT 5,
    "victoryCondition" TEXT NOT NULL DEFAULT '',
    "depositDeadline" TIMESTAMP(3),
    "resolveDeadline" TIMESTAMP(3),
    "contractEventId" TEXT,
    "resultEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetParticipant" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "depositStatus" TEXT NOT NULL DEFAULT 'pending',
    "depositInvoice" TEXT,
    "depositPaymentHash" TEXT,
    "result" TEXT NOT NULL DEFAULT 'pending',
    "payoutStatus" TEXT NOT NULL DEFAULT 'none',
    "payoutMsat" BIGINT,
    "payoutDestination" TEXT,
    "withdrawDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BetParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "amountMsat" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentHash" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bet_status_idx" ON "Bet"("status");

-- CreateIndex
CREATE INDEX "Bet_depositDeadline_idx" ON "Bet"("depositDeadline");

-- CreateIndex
CREATE INDEX "Bet_resolveDeadline_idx" ON "Bet"("resolveDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "BetParticipant_depositPaymentHash_key" ON "BetParticipant"("depositPaymentHash");

-- CreateIndex
CREATE INDEX "BetParticipant_betId_idx" ON "BetParticipant"("betId");

-- CreateIndex
CREATE UNIQUE INDEX "BetParticipant_betId_userId_key" ON "BetParticipant"("betId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_betId_idx" ON "LedgerEntry"("betId");

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetParticipant" ADD CONSTRAINT "BetParticipant_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetParticipant" ADD CONSTRAINT "BetParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
