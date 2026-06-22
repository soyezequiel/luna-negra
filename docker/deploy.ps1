# Actualiza el server (laptop) con el código actual de esta carpeta.
# Uso (en la PC, desde cualquier lado):  powershell -ExecutionPolicy Bypass -File docker\deploy.ps1
# No usa pipes (que PowerShell corrompe): empaqueta a un archivo, lo manda por scp
# y reconstruye en la laptop. Los DATOS de la base no se tocan.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg  = Join-Path $env:TEMP 'luna-update.tgz'

Write-Host '-> Empaquetando codigo...'
tar.exe czf $pkg -C $root --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./backups --exclude=./uploads --exclude=./blob-backup --exclude=./.claude --exclude=./.env --exclude=./.env.docker .

Write-Host '-> Enviando a la laptop...'
scp $pkg luna:luna-update.tgz

Write-Host '-> Reconstruyendo en la laptop (puede tardar la primera vez)...'
ssh luna 'tar xzf ~/luna-update.tgz -C ~/luna-negra && cd ~/luna-negra && docker compose --env-file .env.docker up -d --build && rm ~/luna-update.tgz'

Remove-Item $pkg -ErrorAction SilentlyContinue
Write-Host '== Listo: https://luna.naranja.fit =='
