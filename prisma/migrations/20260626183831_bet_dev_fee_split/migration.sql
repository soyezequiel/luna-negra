-- AlterTable
ALTER TABLE "Bet" ADD COLUMN     "devFeePct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "betDevFeePct" INTEGER,
ADD COLUMN     "betFeePct" INTEGER;

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "betDevFeeMaxPct" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "betDevFeePct" INTEGER NOT NULL DEFAULT 0;
