# Self-hosting de Luna Negra (tu compu como servidor)

Levanta **toda la tienda** (Next 16 + Postgres) en Docker y la expone a internet
con **Cloudflare Tunnel**, sin IP pública ni abrir puertos del router. Mismo
comando en Windows y Linux.

Este es el **modo de producción** de Luna Negra: la app y la base corren en tu
máquina (o en un servidor) y se publican por el túnel.

> 👉 ¿Primera vez? Seguí el **[TUTORIAL paso a paso](TUTORIAL.md)** (de cero a
> online). Este README es la referencia más corta.

---

## TL;DR

```bash
# 1. Config
cp .env.docker.example .env.docker        # Windows: copy .env.docker.example .env.docker
#    Completá al menos JWT_SECRET y TUNNEL_TOKEN (ver abajo).

# 2. Arrancar (build + up)
docker compose --env-file .env.docker up -d --build

# 3. Logs
docker compose logs -f app
```

La app queda en `http://localhost:3000` (local) y en tu dominio del túnel (público).

---

## Requisitos

- Docker Desktop (Windows) o Docker Engine + plugin Compose (Linux).
- Para el túnel con dominio estable: una cuenta de Cloudflare con un dominio
  agregado (el plan gratis alcanza). Si no tenés dominio, usá el *quick tunnel*
  (más abajo): URL efímera, cero configuración.

---

## Paso a paso

### 1. Variables (`.env.docker`)

| Variable            | Obligatoria | Para qué |
|---------------------|-------------|----------|
| `JWT_SECRET`        | **Sí**      | Firma las sesiones. Generá uno fuerte. |
| `POSTGRES_PASSWORD` | recomendada | Password de la DB local. |
| `TUNNEL_TOKEN`      | para túnel con dominio | Token del túnel de Cloudflare. |
| `NEXT_PUBLIC_SITE_URL` | opcional | URL pública (la del túnel); va en los anuncios Nostr. |
| `SEED_ON_START`     | opcional    | `true` carga datos de ejemplo en el primer arranque. |

Generar el `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Cloudflare Tunnel con dominio estable (recomendado)

1. Entrá a **Cloudflare Zero Trust** → **Networks → Tunnels** → **Create a tunnel**.
2. Tipo **Cloudflared**. Ponele un nombre (ej. `luna-negra`).
3. Cloudflare te muestra un **token** (en el comando `cloudflared ... run <TOKEN>`).
   Copiá solo el token y pegalo en `TUNNEL_TOKEN` del `.env.docker`.
4. En la pestaña **Public Hostname** del túnel, agregá:
   - **Subdomain/Domain**: el que quieras servir (ej. `tienda.tudominio.com`).
   - **Service**: `HTTP` → `app:3000`
     > `app` es el nombre del servicio en el compose; cloudflared lo alcanza por
     > la red interna de Docker. **No** uses `localhost`.
5. Guardá. Listo: el túnel enruta tu dominio → la app.

```bash
docker compose --env-file .env.docker up -d --build
```

Tu tienda queda en `https://tienda.tudominio.com` con HTTPS automático.

### 2-bis. Quick tunnel (sin cuenta ni dominio)

URL pública **efímera** (`https://xxxx.trycloudflare.com`), ideal para una prueba
rápida. No necesita `TUNNEL_TOKEN`.

```bash
docker compose --env-file .env.docker \
  -f docker-compose.yml -f docker-compose.quicktunnel.yml up -d --build

docker compose logs -f cloudflared   # la URL trycloudflare.com aparece acá
```

> La URL cambia en cada arranque. Para algo estable usá el túnel con token.

---

## Operación

```bash
# Estado / logs
docker compose ps
docker compose logs -f app
docker compose logs -f cloudflared

# Parar (sin borrar datos)
docker compose down

# Parar y BORRAR la base (¡cuidado!)
docker compose down -v

# Reconstruir tras cambios de código
docker compose --env-file .env.docker up -d --build

# Ver la base con Prisma Studio (la DB está publicada en 127.0.0.1:5432)
#   DATABASE_URL="postgresql://luna:<pass>@localhost:5432/luna" npx prisma studio
```

### Migraciones y seed

- Las migraciones (`prisma migrate deploy`) se aplican **solas** al arrancar el
  contenedor `app` (ver `docker/entrypoint.sh`).
- Para cargar datos de ejemplo la primera vez, poné `SEED_ON_START=true`.

### Datos persistentes

Postgres guarda en el volumen `pgdata`. Sobrevive a `down`/`up`; solo se borra
con `docker compose down -v`.

---

## Base de datos

El `docker-compose.yml` fuerza `DATABASE_URL`/`DIRECT_URL` al **Postgres del compose**
(contenedor `postgres`, datos en el volumen `pgdata`). No depende de ninguna DB externa.

### Notas

- **`NEXT_PUBLIC_SITE_URL`**: se lee en el server en runtime (ok para los anuncios
  Nostr). Si necesitaras que quede *horneada* en el bundle del cliente, habría que
  pasarla como build-arg.
- **Lightning/pagos, apuestas, Sentry, etc.**: son opcionales. Completá sus variables
  en `.env.docker` para activarlas (ver [`DEPLOY.md`](../DEPLOY.md)).
