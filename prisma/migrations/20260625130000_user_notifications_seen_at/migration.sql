-- Marca "visto hasta" del centro de notificaciones (campanita). El feed se
-- deriva en lectura; esta columna sostiene el conteo de no leídos.
ALTER TABLE "User" ADD COLUMN "notificationsSeenAt" TIMESTAMP(3);
