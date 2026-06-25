-- Notificaciones descartadas por el usuario ("marcar leído y que se vaya").
-- Guarda la clave estable del ítem (NotifItem.id) para filtrarlo del feed derivado.
CREATE TABLE "DismissedNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DismissedNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DismissedNotification_userId_key_key" ON "DismissedNotification"("userId", "key");
CREATE INDEX "DismissedNotification_userId_idx" ON "DismissedNotification"("userId");

ALTER TABLE "DismissedNotification" ADD CONSTRAINT "DismissedNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
