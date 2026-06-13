-- Bolsa de estado libre que el juego reporta en su presencia (JSON serializado):
-- puntaje, vidas, equipo, etc. La plataforma no interpreta su contenido.
ALTER TABLE "GamePresence" ADD COLUMN "stateJson" TEXT;
