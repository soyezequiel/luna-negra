# Deploy a producción (Vercel + Postgres)

El proyecto **ya está configurado para Postgres** (`prisma/schema.prisma` usa
`postgresql` con `directUrl`, y la migración inicial está en `prisma/migrations/0_init`).
Solo tenés que crear la DB, poner las URLs y aplicar la migración.

## 1. Base de datos (Supabase o Neon)
Creá un proyecto Postgres y copiá **dos** connection strings:
- **Pooler** (serverless) → `DATABASE_URL`. Supabase: "Connection pooling" (puerto 6543) · Neon: endpoint con `-pooler`.
- **Directa** (sin pooler) → `DIRECT_URL`. Supabase: puerto 5432 · Neon: endpoint sin `-pooler`.

> Si no usás pooler, podés poner la misma URL en ambas.

## 2. Aplicar la migración (crear las tablas)
Con las URLs en tu `.env` local (o exportadas), corré una vez:

```bash
npx prisma migrate deploy   # aplica prisma/migrations/0_init
npm run db:seed             # opcional: datos de ejemplo
```

## 3. Variables de entorno (en Vercel → Settings → Environment Variables)
| Var | Valor |
|---|---|
| `DATABASE_URL` | URL Postgres con **pooler** |
| `DIRECT_URL` | URL Postgres **directa** (migraciones) |
| `JWT_SECRET` | secreto fuerte → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NWC_CONNECTION_STRING` | cadena NWC de tu Alby Hub |
| `ADMIN_PUBKEY` | tu pubkey hex (para `/admin`) |

`JWT_SECRET` es **obligatorio en producción** (la app falla al arrancar si falta).

## 4. Vercel
1. Subí el repo a GitHub e importalo en Vercel (detecta Next.js).
2. Cargá las env vars de arriba.
3. **Deploy.** El `vercel.json` corre en cada build:
   `prisma generate && prisma migrate deploy && next build` → o sea, genera el
   cliente, **aplica las migraciones a la DB** y compila. No hace falta migrar a mano.

> Si preferís migrar manualmente (no en cada build), sacá `prisma migrate deploy`
> del `buildCommand` en `vercel.json` y corré las migraciones por separado.

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
