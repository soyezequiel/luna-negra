#!/bin/sh
# Actualiza el server (laptop) con el código actual de esta carpeta.
# Uso (en la PC, con Git Bash):  sh docker/deploy.sh
# No usa pipes binarios: empaqueta a un archivo, lo manda por scp y reconstruye en
# la laptop. Los DATOS de la base no se tocan.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$(mktemp -t luna-update.XXXXXX.tgz 2>/dev/null || echo /tmp/luna-update.tgz)"

# Identificador de build para el version-poll del cliente (ver src/lib/build-id.ts).
# Se calcula ACÁ porque la laptop no tiene el .git (se excluye del paquete). SHA +
# timestamp: único en cada deploy aunque no haya commit nuevo, así los navegadores
# con una versión vieja abierta detectan el cambio y recargan solos.
build_id="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%s)"

echo "-> Empaquetando código..."
tar czf "$pkg" -C "$root" --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./backups --exclude=./uploads --exclude=./blob-backup --exclude=./.claude --exclude=./.env --exclude=./.env.docker .

echo "-> Enviando a la laptop..."
scp "$pkg" luna:luna-update.tgz

echo "-> Reconstruyendo en la laptop (puede tardar la primera vez)..."
ssh luna "tar xzf ~/luna-update.tgz -C ~/luna-negra && cd ~/luna-negra && NEXT_PUBLIC_BUILD_ID='$build_id' docker compose --env-file .env.docker up -d --build && rm ~/luna-update.tgz"

rm -f "$pkg"
echo "== Listo: https://luna.naranja.fit =="
