# Actualiza el server (laptop) con el código actual de esta carpeta.
# Uso (en la PC, desde cualquier lado):  powershell -ExecutionPolicy Bypass -File docker\deploy.ps1
# No usa pipes (que PowerShell corrompe): empaqueta a un archivo, lo manda por scp
# y reconstruye en la laptop. Los DATOS de la base no se tocan.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg  = Join-Path $env:TEMP 'luna-update.tgz'

# Identificador de build para el version-poll del cliente (ver src/lib/build-id.ts).
# Se calcula ACA porque la laptop no tiene el .git (se excluye del paquete). SHA +
# timestamp: unico en cada deploy aunque no haya commit nuevo, asi los navegadores
# con una version vieja abierta detectan el cambio y recargan solos.
$sha = git -C $root rev-parse --short HEAD
if ($LASTEXITCODE -ne 0 -or -not $sha) { $sha = 'nogit' }
$buildId = "$sha-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

# Guarda: una carpeta de migracion SIN migration.sql (resto de un `prisma migrate
# dev` interrumpido) hace que `prisma migrate deploy` en el entrypoint falle con
# P3015 y el contenedor NUNCA arranque -> 502 en prod. El build no lo detecta, solo
# explota al aplicar migraciones en runtime. Lo cortamos aca antes de empaquetar.
$migrationsDir = Join-Path $root 'prisma\migrations'
if (Test-Path $migrationsDir) {
  $rotas = Get-ChildItem $migrationsDir -Directory |
    Where-Object { -not (Test-Path (Join-Path $_.FullName 'migration.sql')) }
  if ($rotas) {
    $nombres = ($rotas | ForEach-Object { $_.Name }) -join ', '
    throw "Migracion(es) sin migration.sql: $nombres. Borra la carpeta vacia o restaura el archivo antes de deployar (rompe prisma migrate deploy -> 502)."
  }
}

Write-Host '-> Empaquetando codigo...'
# OJO con los excludes en tar.exe de Windows (bsdtar / libarchive). VERIFICADO
# empaquetando ESTE repo con este tar.exe (2026-06-25, ver memoria
# deploy-exclude-rompia-uploads). El matcheo NO ancla a la raiz:
#  - `--exclude=NAME` y `--exclude=./NAME` matchean el componente `NAME` en
#    CUALQUIER nivel -> AMBOS se comen `src/app/uploads/` (la ruta que SIRVE las
#    imagenes) y dan 404 en prod. NO usar para `uploads`.
#  - `--exclude=/NAME` (con `/` inicial) es la forma que SI deja `src/app/uploads`
#    intacto. Es casi un no-op (no llega a excluir el top-level), pero como NO
#    debe existir un `uploads/` en la raiz del repo, alcanza.
# IMPORTANTE: para que NO viaje un `uploads/` top-level (su extraccion sobre el
# volumen montado de la laptop falla con "Operacion no permitida"), en dev los
# uploads van FUERA del repo via UPLOADS_DIR en .env (no a ./uploads). `backups` y
# `blob-backup` no colisionan con nada en src, asi que esos si usan `./NAME`.
tar.exe czf $pkg -C $root --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./backups --exclude=/uploads --exclude=./blob-backup --exclude=./.claude --exclude=./.env --exclude=./.env.docker .

Write-Host '-> Enviando a la laptop...'
scp $pkg luna:luna-update.tgz
if ($LASTEXITCODE -ne 0) { throw "scp fallo (exit $LASTEXITCODE): el paquete no llego a la laptop." }

Write-Host '-> Reconstruyendo en la laptop (puede tardar la primera vez)...'
# OJO: `tar xzf` extrae ENCIMA del dir existente y NO borra archivos que ya no
# estan en el paquete. Si se borro/renombro un archivo de codigo, su copia vieja
# queda en la laptop y el build la levanta (rompe, p. ej. un import a un export
# que ya no existe). Por eso borramos `src` antes de extraer: el .tgz SIEMPRE
# trae el `src` completo. Los datos (uploads/backups/.env) viven fuera de `src` y
# estan excluidos del paquete, asi que no se tocan.
ssh luna "rm -rf ~/luna-negra/src && tar xzf ~/luna-update.tgz -C ~/luna-negra && cd ~/luna-negra && NEXT_PUBLIC_BUILD_ID='$buildId' docker compose --env-file .env.docker up -d --build && rm ~/luna-update.tgz"
# El comando remoto encadena con `&&`: si tar/build/compose fallan, ssh devuelve
# != 0. Sin esto, el script imprimia "Listo" aunque NO se hubiera reconstruido.
if ($LASTEXITCODE -ne 0) { throw "El deploy remoto fallo (exit $LASTEXITCODE): revisa la salida de arriba. La app NO se reconstruyo." }

Remove-Item $pkg -ErrorAction SilentlyContinue
Write-Host '== Listo: https://luna.naranja.fit =='
