# Luna Negra 🌑

Tienda de juegos **100% web** estilo Steam, con pagos en **Bitcoin/Lightning** vía Nostr. Sin instalar nada: se juega desde el navegador.

> Plan completo del MVP en [`PLAN.md`](./PLAN.md).

## Estado (Días 1-3 ✅)
- [x] Scaffold Next.js 16 + React 19 + Tailwind v4.
- [x] Modelo de datos (Prisma): users, providers, games, purchases, reviews.
- [x] Login **Nostr (NIP-07)** end-to-end → sesión JWT en cookie httpOnly.
- [x] Layout oscuro estilo Steam (Tienda / Biblioteca / Perfil).
- [x] Perfil leído de Nostr (metadata kind:0) desde relays públicos.

### Semana 1 (en curso ✅)
- [x] Catálogo desde DB (home grid + página de juego) con datos de ejemplo (`npx prisma db seed`).
- [x] Flujo de compra: invoice por NWC → modal con **QR** + copiar → **polling** → entitlement.
- [x] Payout 70/30 automático a la Lightning Address del proveedor (`src/lib/payments.ts`).
- [x] Biblioteca con los juegos comprados.
- [x] **Modo dev** sin wallet: botón "Simular pago" para probar todo el flujo sin Alby Hub.

Pendiente Semana 1: crear el wallet **Alby Hub** real y poner `NWC_CONNECTION_STRING` para pagos de verdad.

### Semana 2 ✅
- [x] **API de entitlements**: `play-token` (firma un JWT corto si poseés el juego) + `verify` (público, CORS) para el game server.
- [x] **Juego demo** en `public/demo-game/` que lee el `lnToken`, verifica el acceso y se juega → prueba comprar→acceder→jugar real.
- [x] **Panel de proveedor** (`/provider`): alta de proveedor, alta de juego (borrador), enviar a revisión.
- [x] **Admin** (`/admin`): aprobar y publicar juegos en revisión (admin por `ADMIN_PUBKEY`, o cualquiera en dev).
- [x] **Reseñas y ratings** (requiere poseer el juego), con promedio en la página del juego.

### Semana 3 ✅ (social vía Nostr)
- [x] **Amigos** (`/friends`): lee tu lista de contactos (NIP-02), cruza con `/api/users/known` (usuarios de Luna Negra arriba), muestra sus juegos y su **estado/presencia** (NIP-38). Incluye setter de tu propio estado.
- [x] **Actividad por juego**: notas Nostr (kind:1) etiquetadas `lunanegra:game:<slug>`, leídas/publicadas desde la página del juego.
- [x] **Chat** (`/messages`): DMs cifrados con **NIP-04** — lista de conversaciones, hilo descifrado y envío; iniciar por npub.
- Todo lo social vive en **relays públicos** (no en la DB); solo `/api/users/known` cruza npubs con la DB.

### Semana 4 ✅ (pulido + listo para deploy)
- [x] Hardening: rate-limit en pagos/auth, headers de seguridad, `JWT_SECRET` obligatorio en prod.
- [x] Build deploy-ready (`prisma generate && next build`) + guía [`DEPLOY.md`](./DEPLOY.md) (Postgres + Vercel).
- [x] Pulido: footer, página 404, navbar scrollable en mobile, **expiración de invoice** en el modal de compra.
- [x] Docs de integración para proveedores: [`DEVELOPERS.md`](./DEVELOPERS.md).

**MVP completo.** Para publicar, seguí [`DEPLOY.md`](./DEPLOY.md).

## Requisitos
- Node 20+ (probado con 24).
- Una **extensión Nostr** en el navegador para loguear: [nos2x](https://github.com/fiatjaf/nos2x) o [Alby](https://getalby.com/).

## Setup

Usa **Postgres** (Neon o Supabase, ambos con free tier) en local y en prod.

```bash
# 1. Instalar dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
#   - DATABASE_URL / DIRECT_URL → tu Postgres (Neon/Supabase)
#   - cambiá JWT_SECRET por uno fuerte

# 3. Crear las tablas + cliente Prisma
npx prisma migrate deploy
npx prisma generate

# 4. (opcional) datos de ejemplo
npm run db:seed

# 5. Levantar
npm run dev
```

Abrí http://localhost:3000 y tocá **“Conectar con Nostr”** (necesitás la extensión).

> ¿Cero setup para probar rápido? Podés crear una DB Neon gratis en 1 min y usar
> la misma URL en local y en Vercel.

## Scripts útiles
- `npm run dev` — desarrollo.
- `npm run build` — build de producción (`prisma generate && next build`).
- `npx prisma studio` — explorar la base de datos.

## Pasar a producción (Vercel)
Ya está configurado para Postgres. Pasos completos en [`DEPLOY.md`](./DEPLOY.md):
crear DB → cargar envs → `npx prisma migrate deploy` → deploy en Vercel.

## Arquitectura (resumen)
- **Frontend + API:** Next.js (App Router) en Vercel.
- **Identidad:** npub (Nostr); login NIP-07 firmando un challenge → cookie de sesión.
- **Social:** amigos / chat / actividad viven en **relays Nostr** públicos (no en la DB).
- **Pagos (Semana 1):** Alby Hub vía NWC; Luna Negra cobra y reparte 70/30.

Detalle completo en [`PLAN.md`](./PLAN.md).
# luna-negra
