-- El juego publicado pasa a tener como fuente de verdad un artículo NIP-23
-- (kind:30023, direccionable/editable) firmado por la tienda. La DB es un caché
-- write-through, reconciliable desde Nostr por game-sync.ts. `nostrEventId` ya
-- existía (era el id de la vieja nota kind:1); ahora guarda el id del último
-- artículo 30023. Agregamos la coordenada estable y la metadata de freshness.
ALTER TABLE "Game" ADD COLUMN "nostrCoord" TEXT;
ALTER TABLE "Game" ADD COLUMN "nostrPublishedAt" TIMESTAMP(3);
ALTER TABLE "Game" ADD COLUMN "nostrUpdatedAt" TIMESTAMP(3);
