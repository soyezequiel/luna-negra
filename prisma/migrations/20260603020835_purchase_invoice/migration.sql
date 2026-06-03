/*
  Warnings:

  - You are about to drop the column `invoiceId` on the `Purchase` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "invoice" TEXT,
    "paymentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutStatus" TEXT NOT NULL DEFAULT 'none',
    "payoutHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Purchase" ("amountSats", "createdAt", "gameId", "id", "paidAt", "paymentHash", "payoutHash", "payoutStatus", "status", "userId") SELECT "amountSats", "createdAt", "gameId", "id", "paidAt", "paymentHash", "payoutHash", "payoutStatus", "status", "userId" FROM "Purchase";
DROP TABLE "Purchase";
ALTER TABLE "new_Purchase" RENAME TO "Purchase";
CREATE UNIQUE INDEX "Purchase_userId_gameId_key" ON "Purchase"("userId", "gameId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
