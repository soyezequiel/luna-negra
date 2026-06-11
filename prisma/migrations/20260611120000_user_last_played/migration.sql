-- Última vez que el usuario lanzó/jugó un juego (ordena la lista de amigos).
ALTER TABLE "User" ADD COLUMN "lastPlayedAt" TIMESTAMP(3);
