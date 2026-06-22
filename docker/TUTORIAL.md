# Tutorial: servir Luna Negra desde tu compu (fallback con Docker)

Guía de cero a "mi tienda está online" usando **Docker + Cloudflare Tunnel**.
No necesitás IP pública ni abrir puertos del router. Funciona igual en **Windows**
y **Linux**.

Tiempo estimado: ~15–20 min (la primera vez, por la descarga de imágenes).

> ¿Qué vamos a montar? Tu computadora corriendo 3 contenedores:
> **app** (Next.js) + **postgres** (la base de datos) + **cloudflared** (el túnel
> que publica la tienda en internet con HTTPS).

---

## Paso 0 — Requisitos

1. **Docker** instalado:
   - **Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop/).
     Tras instalarlo, **abrilo** y esperá a que el ícono diga **"Engine running"**.
   - **Linux**: Docker Engine + plugin Compose
     (`sudo apt install docker.io docker-compose-plugin` o el de tu distro).
2. **Node.js** en tu máquina (solo para generar un secreto en el Paso 2). Si no
   tenés, podés generar el secreto de otra forma (te muestro una alternativa).
3. Estar parado en la carpeta del proyecto:
   ```
   F:\proyectos\Tienda juegos PC Nostr
   ```

Comprobá que Docker responde (debe imprimir una versión, no un error de "daemon"):

```bash
docker info
```

> ⛔ Si ves `failed to connect to the docker API ... daemon is running`, el motor
> de Docker **no está levantado**. En Windows: abrí **Docker Desktop** y esperá a
> "Engine running". En Linux: `sudo systemctl start docker`.

---

## Paso 1 — Crear tu archivo de configuración

Copiá la plantilla a `.env.docker` (este archivo guarda tus secretos y **no** se
sube a git):

**Windows (PowerShell):**
```powershell
copy .env.docker.example .env.docker
```

**Linux / Git Bash:**
```bash
cp .env.docker.example .env.docker
```

Abrí `.env.docker` con tu editor. Lo completamos en los próximos pasos.

---

## Paso 2 — Generar el `JWT_SECRET` (obligatorio)

Firma las sesiones de login. Generá uno fuerte:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiá la cadena que imprime y pegala en `.env.docker`:

```
JWT_SECRET=ab12cd34...la-cadena-larga-que-generaste
```

> Sin Node a mano: en PowerShell podés usar
> `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')` como
> alternativa rápida (menos ideal, pero sirve para empezar).

Aprovechá y poné una password para la base:

```
POSTGRES_PASSWORD=algo-secreto-que-elijas
```

---

## Paso 3 — Crear el túnel de Cloudflare

Esto es lo que publica tu tienda en internet sin IP pública. Hay **dos caminos**.
Elegí uno:

### Camino A — Túnel con tu dominio (recomendado, URL estable)

Necesitás una cuenta de Cloudflare con un **dominio agregado** (el plan gratis
sirve).

1. Entrá a **[Cloudflare Zero Trust](https://one.dash.cloudflare.com/)**.
2. Menú izquierdo: **Networks → Tunnels** → botón **Create a tunnel**.
3. Elegí el tipo **Cloudflared** → **Next**.
4. Nombre del túnel: `luna-negra` (o el que quieras) → **Save tunnel**.
5. En la pantalla de "Install and run a connector", Cloudflare te muestra un
   comando que contiene un **token largo** (después de `--token`). **Copiá solo
   ese token** (la cadena larga, sin el resto del comando).
6. Pegalo en `.env.docker`:
   ```
   TUNNEL_TOKEN=eyJ...el-token-largo
   ```
7. **No cierres todavía**: andá a la pestaña **Public Hostnames** → **Add a
   public hostname**:
   - **Subdomain**: lo que quieras (ej. `tienda`).
   - **Domain**: elegí tu dominio.
   - **Service** → **Type**: `HTTP`
   - **URL**: `app:3000`
     > Importante: es `app:3000`, **no** `localhost`. `app` es el nombre del
     > contenedor; cloudflared lo encuentra por la red interna de Docker.
8. **Save hostname**.

Tu tienda quedará en `https://tienda.tudominio.com`.

### Camino B — Quick tunnel (sin cuenta, para probar ya)

Cero configuración: Cloudflare te da una URL pública **temporal**
(`https://algo-aleatorio.trycloudflare.com`). Cambia cada vez que reiniciás.

- Dejá `TUNNEL_TOKEN=` **vacío** en `.env.docker`.
- En el Paso 4 vas a usar el comando con el override de quick tunnel.

---

## Paso 4 — Levantar todo

### Si elegiste el Camino A (token):

```bash
docker compose --env-file .env.docker up -d --build
```

### Si elegiste el Camino B (quick tunnel):

```bash
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.quicktunnel.yml up -d --build
```

La **primera vez** tarda varios minutos: descarga las imágenes base, instala
dependencias y compila la app. Las siguientes veces es mucho más rápido.

Mirá el progreso:

```bash
docker compose logs -f app
```

Cuando veas esto, la app ya está sirviendo:

```
→ Aplicando migraciones (prisma migrate deploy)...
→ Iniciando Next.js en 0.0.0.0:3000
   ✓ Ready in ...
```

(`Ctrl+C` corta el seguimiento de logs; **no** apaga la app.)

---

## Paso 5 — Probar que anda

1. **Local** (siempre):
   ```bash
   curl http://localhost:3000
   ```
   O abrí `http://localhost:3000` en el navegador.

2. **Público**:
   - Camino A: abrí `https://tienda.tudominio.com`.
   - Camino B: buscá la URL en los logs del túnel:
     ```bash
     docker compose logs cloudflared
     ```
     Buscá una línea con `https://....trycloudflare.com` y abrila.

3. ¿Catálogo vacío? Es esperable si la base nueva no tiene juegos. Para cargar
   datos de ejemplo, mirá el Paso 6.

---

## Paso 6 — (Opcional) Cargar datos de ejemplo

Si querés arrancar con juegos de prueba, poné en `.env.docker`:

```
SEED_ON_START=true
```

Y reiniciá la app:

```bash
docker compose --env-file .env.docker up -d
```

El seed corre **una vez** al arrancar. Después podés volver a poner
`SEED_ON_START=false`.

---

## Operación diaria

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs (app o túnel)
docker compose logs -f app
docker compose logs -f cloudflared

# Apagar (los datos se conservan)
docker compose down

# Volver a encender
docker compose --env-file .env.docker up -d

# Aplicar cambios de código (rebuild)
docker compose --env-file .env.docker up -d --build
```

### Ver/editar la base de datos

La DB está publicada solo en tu máquina (`127.0.0.1:5432`). Con Prisma Studio:

```bash
# Reemplazá <pass> por tu POSTGRES_PASSWORD
DATABASE_URL="postgresql://luna:<pass>@localhost:5432/luna" npx prisma studio
```

---

## Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `failed to connect to the docker API ... daemon` | Docker no está corriendo. Abrí Docker Desktop (Win) o `sudo systemctl start docker` (Linux). |
| `env file ... .env.docker not found` | No creaste `.env.docker` (Paso 1) o no pasaste `--env-file .env.docker`. |
| La app reinicia con `No se pudo migrar tras 10 intentos` | Postgres no levantó. Revisá `docker compose logs postgres`. Suele ser un volumen viejo corrupto: `docker compose down -v` y volvé a subir (¡borra datos!). |
| El dominio no abre (Camino A) | Revisá que el **Public Hostname** apunte a `app:3000` (no `localhost`) y que `cloudflared` esté `running` en `docker compose ps`. |
| `Ports are not available: 3000` o `5432` | Ya tenés algo usando ese puerto (otro `next dev`, otro Postgres). Cerralo, o cambiá el mapeo en `docker-compose.yml` (ej. `"3001:3000"`). |
| `entrypoint.sh: not found` / `no such file` | Line endings CRLF. El Dockerfile ya los normaliza; si editaste el script, guardá con saltos de línea **LF**. |

---

## Cómo apagar el fallback y volver a Neon/Vercel

Esto es solo un respaldo. Cuando Neon vuelva:

1. `docker compose down` (apaga el fallback; los datos quedan en el volumen).
2. Tu deploy normal en Vercel sigue usando Neon vía `.env` — no tocaste nada de eso.

> Ojo: los datos creados mientras corriste el fallback viven en **el Postgres
> local** (volumen `pgdata`), no en Neon. Si generaste datos importantes acá y
> querés llevarlos a Neon, hay que exportarlos/importarlos aparte (decime y te
> armo el `pg_dump` → `pg_restore`).

---

¿Algo no salió como dice el tutorial? Pegame el output de
`docker compose logs app` y lo miramos.
