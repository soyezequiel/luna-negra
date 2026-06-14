-- CreateTable: magic links de login por email ya canjeados (consumo de un solo
-- uso). El JWT del link trae un `jti` único; al canjearlo insertamos ese jti y el
-- PK lo hace atómico (un segundo canje del mismo link choca y se rechaza).
--
-- Se usa IF NOT EXISTS por la misma razón que el resto de migraciones aditivas:
-- en dev la tabla puede haberse creado con `prisma db push`. `migrate deploy`
-- aplica sin reset ni pérdida de datos.
CREATE TABLE IF NOT EXISTS "ConsumedMagicLink" (
    "jti" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumedMagicLink_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConsumedMagicLink_expiresAt_idx" ON "ConsumedMagicLink"("expiresAt");
