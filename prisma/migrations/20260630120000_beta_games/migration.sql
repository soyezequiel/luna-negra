-- AlterTable
ALTER TABLE "User" ADD COLUMN     "showBetaGames" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "isBeta" BOOLEAN NOT NULL DEFAULT false;
