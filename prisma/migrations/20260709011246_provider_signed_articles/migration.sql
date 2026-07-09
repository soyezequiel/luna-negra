-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "articleDirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "articleSigner" TEXT NOT NULL DEFAULT 'store',
ADD COLUMN     "signedArticle" JSONB;
