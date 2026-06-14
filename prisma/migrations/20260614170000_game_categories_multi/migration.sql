-- Pasa de una sola categoría (`category`) a varias (`categories` como array de slugs).
-- AlterTable: agrega el array y backfillea con la categoría existente (si la había).
ALTER TABLE "Game" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Game"
SET "categories" = ARRAY["category"]
WHERE "category" IS NOT NULL;

ALTER TABLE "Game" DROP COLUMN "category";
