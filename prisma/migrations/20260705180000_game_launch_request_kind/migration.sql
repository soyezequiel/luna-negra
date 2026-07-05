-- Distingue las salas hosteadas por Luna de los enlaces de sala hosteados por el juego.
ALTER TABLE "GameLaunchRequest"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'luna-room';
