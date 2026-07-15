-- Código de amistad corto para todos los usuarios existentes y futuros.
-- El espacio de seis dígitos admite 999.999 identidades; la secuencia falla de
-- forma explícita al agotarse en vez de emitir un código de siete dígitos.
CREATE SEQUENCE "User_friendCode_seq"
  MINVALUE 1
  MAXVALUE 999999
  START 1
  NO CYCLE;

ALTER TABLE "User" ADD COLUMN "friendCode" INTEGER;
ALTER TABLE "User"
  ALTER COLUMN "friendCode" SET DEFAULT nextval('"User_friendCode_seq"');

UPDATE "User"
SET "friendCode" = nextval('"User_friendCode_seq"')
WHERE "friendCode" IS NULL;

ALTER SEQUENCE "User_friendCode_seq" OWNED BY "User"."friendCode";
ALTER TABLE "User" ALTER COLUMN "friendCode" SET NOT NULL;

CREATE UNIQUE INDEX "User_friendCode_key" ON "User"("friendCode");
ALTER TABLE "User"
  ADD CONSTRAINT "User_friendCode_six_digits"
  CHECK ("friendCode" BETWEEN 1 AND 999999);
