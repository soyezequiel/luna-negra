-- CreateTable
CREATE TABLE "Leaderboard" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Leaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "leaderboardId" TEXT NOT NULL,
    "npub" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Leaderboard_gameId_idx" ON "Leaderboard"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Leaderboard_gameId_name_key" ON "Leaderboard"("gameId", "name");

-- CreateIndex
CREATE INDEX "Score_leaderboardId_score_idx" ON "Score"("leaderboardId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Score_leaderboardId_npub_key" ON "Score"("leaderboardId", "npub");

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
