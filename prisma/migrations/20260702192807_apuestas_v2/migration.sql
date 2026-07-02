-- CreateTable
CREATE TABLE "ZapBet" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "stakeMsat" BIGINT NOT NULL,
    "feePct" INTEGER NOT NULL DEFAULT 5,
    "devFeePct" INTEGER NOT NULL DEFAULT 0,
    "victoryCondition" TEXT NOT NULL DEFAULT '',
    "roomId" TEXT,
    "metadataJson" TEXT,
    "depositDeadline" TIMESTAMP(3),
    "resolveDeadline" TIMESTAMP(3),
    "anchorEventId" TEXT,
    "contractHash" TEXT,
    "resultEventId" TEXT,
    "settleNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ZapBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZapBetParticipant" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "depositStatus" TEXT NOT NULL DEFAULT 'pending',
    "depositZapRequest" TEXT,
    "depositInvoice" TEXT,
    "depositPaymentHash" TEXT,
    "depositReceiptId" TEXT,
    "depositReceiptJson" TEXT,
    "depositReceiptOk" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL DEFAULT 'pending',
    "payoutStatus" TEXT NOT NULL DEFAULT 'none',
    "payoutMsat" BIGINT,
    "payoutDestination" TEXT,
    "payoutKind" TEXT,
    "payoutZapRequestId" TEXT,
    "payoutReceiptId" TEXT,
    "withdrawDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ZapBetParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZapLedgerEntry" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "amountMsat" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentHash" TEXT,
    "zapRequestId" TEXT,
    "zapReceiptId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZapLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZapBet_anchorEventId_key" ON "ZapBet"("anchorEventId");

-- CreateIndex
CREATE INDEX "ZapBet_status_idx" ON "ZapBet"("status");

-- CreateIndex
CREATE INDEX "ZapBet_depositDeadline_idx" ON "ZapBet"("depositDeadline");

-- CreateIndex
CREATE INDEX "ZapBet_resolveDeadline_idx" ON "ZapBet"("resolveDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "ZapBetParticipant_depositPaymentHash_key" ON "ZapBetParticipant"("depositPaymentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ZapBetParticipant_depositReceiptId_key" ON "ZapBetParticipant"("depositReceiptId");

-- CreateIndex
CREATE INDEX "ZapBetParticipant_betId_idx" ON "ZapBetParticipant"("betId");

-- CreateIndex
CREATE UNIQUE INDEX "ZapBetParticipant_betId_userId_key" ON "ZapBetParticipant"("betId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ZapLedgerEntry_idempotencyKey_key" ON "ZapLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ZapLedgerEntry_betId_idx" ON "ZapLedgerEntry"("betId");

-- AddForeignKey
ALTER TABLE "ZapBet" ADD CONSTRAINT "ZapBet_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapBet" ADD CONSTRAINT "ZapBet_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapBetParticipant" ADD CONSTRAINT "ZapBetParticipant_betId_fkey" FOREIGN KEY ("betId") REFERENCES "ZapBet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapBetParticipant" ADD CONSTRAINT "ZapBetParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapLedgerEntry" ADD CONSTRAINT "ZapLedgerEntry_betId_fkey" FOREIGN KEY ("betId") REFERENCES "ZapBet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapLedgerEntry" ADD CONSTRAINT "ZapLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
