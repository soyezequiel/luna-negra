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

Write-Host '-> Empaquetando codigo...'
# OJO con los excludes en tar.exe de Windows (bsdtar / libarchive):
#  - `--exclude=./NAME` matchea el componente `NAME` en CUALQUIER nivel. Sirve
#    para carpetas de datos top-level que NO comparten nombre con nada dentro de
#    `src` (backups, blob-backup): las saca de verdad y sin danio colateral.
#  - `uploads` SI colisiona: `src/app/uploads/` es la ruta que SIRVE las
#    imagenes, asi que `--exclude=./uploads` tambien se la comia y en produccion
#    daban 404. Por eso queda anclado `--exclude=/uploads`. (En este bsdtar esa
#    forma anclada en la practica no matchea `./uploads`, o sea es casi un no-op,
#    pero lo importante es que NUNCA borra `src/app/uploads`; en dev no hay una
#    carpeta `uploads` top-level que haga falta excluir.)
# Nota: `--exclude=/backups` (anclado) NO excluia nada -> `./backups` (root del
# contenedor de backups) viajaba en el paquete y la extraccion en la laptop
# fallaba con "Operacion no permitida". De ahi el cambio a `./backups`.
tar.exe czf $pkg -C $root --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./backups --exclude=/uploads --exclude=./blob-backup --exclude=./.claude --exclude=./.env --exclude=./.env.docker .

Write-Host '-> Enviando a la laptop...'
scp $pkg luna:luna-update.tgz

Write-Host '-> Reconstruyendo en la laptop (puede tardar la primera vez)...'
# OJO: `tar xzf` extrae ENCIMA del dir existente y NO borra archivos que ya no
# estan en el paquete. Si se borro/renombro un archivo de codigo, su copia vieja
# queda en la laptop y el build la levanta (rompe, p. ej. un import a un export
# que ya no existe). Por eso borramos `src` antes de extraer: el .tgz SIEMPRE
# trae el `src` completo. Los datos (uploads/backups/.env) viven fuera de `src` y
# estan excluidos del paquete, asi que no se tocan.
ssh luna "rm -rf ~/luna-negra/src && tar xzf ~/luna-update.tgz -C ~/luna-negra && cd ~/luna-negra && NEXT_PUBLIC_BUILD_ID='$buildId' docker compose --env-file .env.docker up -d --build && rm ~/luna-update.tgz"

Remove-Item $pkg -ErrorAction SilentlyContinue
Write-Host '== Listo: https://luna.naranja.fit =='
