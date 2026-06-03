# Deploy a producción (Vercel + Postgres)

Local usa **SQLite**; producción usa **Postgres**. Pasos:

## 1. Base de datos (Supabase o Neon)
Creá un proyecto Postgres y copiá la connection string. Para serverless usá la
**URL con pooler** (Supabase: "Connection pooling" / Neon: endpoint `-pooler`).

## 2. Cambiar Prisma a Postgres
En `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Las migraciones actuales son de SQLite, así que para una DB nueva:

```bash
rm -rf prisma/migrations prisma/dev.db          # (PowerShell: Remove-Item -Recurse -Force prisma\migrations, prisma\dev.db)
$env:DATABASE_URL="postgresql://...";  npx prisma migrate dev --name init
```

Esto genera migraciones de Postgres. Commiteá `prisma/migrations`.

> Tip pooler: si usás PgBouncer, agregá `?pgbouncer=true&connection_limit=1` a
> la URL, o definí un `directUrl` en el datasource para las migraciones.

## 3. Variables de entorno (en Vercel → Settings → Environment Variables)
| Var | Valor |
|---|---|
| `DATABASE_URL` | URL Postgres (pooler) |
| `JWT_SECRET` | secreto fuerte → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NWC_CONNECTION_STRING` | cadena NWC de tu Alby Hub |
| `ADMIN_PUBKEY` | tu pubkey hex (para `/admin`) |

`JWT_SECRET` es **obligatorio en producción** (la app falla al arrancar si falta).

## 4. Vercel
1. Subí el repo a GitHub e importalo en Vercel (detecta Next.js).
2. El `build` ya corre `prisma generate && next build`.
3. Cargá las env vars de arriba → **Deploy**.

## 5. Datos iniciales
- Opción A: cargá el seed contra prod → `$env:DATABASE_URL="<prod>"; npm run db:seed`.
- Opción B: creá juegos reales desde `/provider` y aprobalos desde `/admin`.

## 6. Juegos y dominios
- El juego demo es same-origin (`/demo-game/index.html`).
- Los proveedores hostean su juego donde quieran (subdominio propio) y ponen esa
  URL en `gameUrl`. Luna Negra lo abre con `?lnToken=<jwt>` (ver `DEVELOPERS.md`).

## 7. Checklist de seguridad
- [ ] `JWT_SECRET` fuerte y único.
- [ ] `ADMIN_PUBKEY` seteado (si no, en prod nadie es admin).
- [ ] Rotaste el NWC si lo compartiste en algún lado; ponele budget bajo.
- [ ] Rate-limit: el actual es en memoria (best-effort). Para tráfico real,
      migrar a Upstash/Redis (`@upstash/ratelimit`).
- [ ] Recordá: NIP-04 (chat) expone metadata; migrar a NIP-17 post-lanzamiento.
