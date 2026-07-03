# Abre un túnel SSH desde esta PC (Windows) al Postgres de PRODUCCIÓN de la laptop.
#
# El Postgres de prod (contenedor luna-negra-postgres-1) está publicado SOLO en
# 127.0.0.1:5433 de la laptop, no en la LAN. Este túnel lo expone en 127.0.0.1:5434
# de esta PC (5433 ya lo usa el contenedor de dev luna-negra-devdb).
#
#   Local 127.0.0.1:5434  ->  ssh luna  ->  laptop 127.0.0.1:5433 (Postgres prod)
#
# ⚠️  Con el túnel arriba y el .env apuntando a 5434, `npm run dev` escribe en la
#     BASE DE PRODUCCIÓN. Cuidado con `prisma migrate dev`, seeds y datos de prueba.
#
# Uso:
#   ./docker/prod-db-tunnel.ps1          # abre el túnel (bloquea; Ctrl+C para cerrar)
#   ./docker/prod-db-tunnel.ps1 -Check   # solo verifica si el puerto 5434 responde

param([switch]$Check)

$LocalPort = 5434

if ($Check) {
    $ok = (Test-NetConnection -ComputerName 127.0.0.1 -Port $LocalPort -WarningAction SilentlyContinue).TcpTestSucceeded
    if ($ok) { Write-Host "Túnel ACTIVO en 127.0.0.1:$LocalPort" -ForegroundColor Green }
    else     { Write-Host "Túnel CAÍDO (nada escucha en 127.0.0.1:$LocalPort)" -ForegroundColor Yellow }
    return
}

Write-Host "Abriendo túnel a Postgres de PRODUCCIÓN en 127.0.0.1:$LocalPort ..." -ForegroundColor Cyan
Write-Host "⚠️  Con el .env apuntando a este puerto, dev escribe en PROD. Ctrl+C para cerrar." -ForegroundColor Yellow
ssh -N -L 127.0.0.1:${LocalPort}:localhost:5433 luna
