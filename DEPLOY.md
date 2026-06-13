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
3. **Deploy.** El `vercel.json` corre `prisma generate && next build`. El build
   **no toca la DB** (las páginas son `force-dynamic`), así que no falla por la base.

Las **migraciones se aplican aparte** (paso 2), no en el build. Así el deploy nunca
depende de que la DB esté accesible en ese momento. Cuando cambies el schema,
volvé a correr `npx prisma migrate deploy` contra prod.

## 5. Datos iniciales
- Opción A: cargá el seed contra prod → `$env:DATABASE_URL="<prod>"; npm run db:seed`.
- Opción B: creá juegos reales desde `/provider` y aprobalos desde `/admin`.

## 6. Juegos y dominios
- El juego demo es same-origin (`/demo-game/index.html`).
- Los proveedores hostean su juego donde quieran (subdominio propio) y ponen esa
  URL en `gameUrl`. Luna Negra lo abre con `?lnToken=<jwt>` (ver `docs/api-publica.md`).

## Producción a escala (Fase B)

### Rate limiting real (Upstash)
1. Crear un **Redis** gratis en [upstash.com](https://upstash.com).
2. Copiar **REST URL** y **REST Token**.
3. En Vercel agregar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` → Redeploy.
4. La app los usa automáticamente; sin ellos cae al rate-limit en memoria.

### Dominio propio
1. Vercel → proyecto → **Settings → Domains** → **Add**.
2. Ingresá tu dominio y seguí los pasos de DNS (registro A / CNAME a Vercel).
3. Vercel emite el certificado HTTPS solo.

### Backups de la base (Neon)
- Neon hace **branching** y **Point-in-Time Restore** (PITR). En el dashboard de
  Neon → tu proyecto → **Settings/Backups**, verificá la ventana de retención del
  plan (en free es corta; subí de plan si necesitás más).

### Monitoreo de errores (Sentry) — pendiente
- `npx @sentry/wizard@latest -i nextjs` configura el SDK. Requiere un DSN de Sentry.
  Hacerlo con cuidado (toca `next.config.ts` / instrumentación) y probar el build
  antes de pushear, para no romper el deploy en vivo.

## 7. Checklist de seguridad
- [ ] `JWT_SECRET` fuerte y único.
- [ ] `ADMIN_PUBKEY` seteado (si no, en prod nadie es admin).
- [ ] Rotaste el NWC si lo compartiste en algún lado; ponele budget bajo.
- [ ] Rate-limit: el actual es en memoria (best-effort). Para tráfico real,
      migrar a Upstash/Redis (`@upstash/ratelimit`).
- [ ] Recordá: NIP-04 (chat) expone metadata; migrar a NIP-17 post-lanzamiento.
