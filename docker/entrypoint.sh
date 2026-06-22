#!/bin/sh
# Arranque del contenedor de la app: aplica migraciones contra el Postgres del
# compose y luego levanta Next. depends_on espera a que Postgres esté "healthy",
# pero igual reintentamos por las dudas (cold start de la DB).
set -e

echo "→ Aplicando migraciones (prisma migrate deploy)..."
n=0
until npx prisma migrate deploy; do
  n=$((n + 1))
  if [ "$n" -ge 10 ]; then
    echo "✗ No se pudo migrar tras 10 intentos. ¿Está Postgres arriba?"
    exit 1
  fi
  echo "  Postgres todavía no responde, reintento $n/10 en 3s..."
  sleep 3
done

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "→ Seed inicial (SEED_ON_START=true)..."
  npx prisma db seed || echo "  (el seed falló o los datos ya existen; continúo)"
fi

echo "→ Iniciando Next.js en 0.0.0.0:3000"
exec npx next start -H 0.0.0.0 -p 3000
