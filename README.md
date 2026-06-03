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

Próximo (Semana 2): juego demo + API de entitlements + panel de proveedor + reseñas.

## Requisitos
- Node 20+ (probado con 24).
- Una **extensión Nostr** en el navegador para loguear: [nos2x](https://github.com/fiatjaf/nos2x) o [Alby](https://getalby.com/).

## Setup

```bash
# 1. Instalar dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
#   - DATABASE_URL ya viene con SQLite local (no requiere nada externo)
#   - cambiá JWT_SECRET por uno fuerte

# 3. Crear la base de datos local (SQLite) + cliente Prisma
npx prisma migrate dev

# 4. Levantar
npm run dev
```

Abrí http://localhost:3000 y tocá **“Conectar con Nostr”** (necesitás la extensión).

## Scripts útiles
- `npm run dev` — desarrollo.
- `npm run build` — build de producción.
- `npx prisma studio` — explorar la base de datos.

## Pasar a producción (Vercel)
1. En `prisma/schema.prisma`, cambiar `provider = "sqlite"` → `"postgresql"`.
2. Crear una DB Postgres en **Supabase** o **Neon** y poner su URL en `DATABASE_URL`.
3. `npx prisma migrate deploy`.
4. Generar un `JWT_SECRET` fuerte.
5. (Semana 1) Crear un wallet **Alby Hub**, obtener la cadena **NWC** y ponerla en `NWC_CONNECTION_STRING`.

## Arquitectura (resumen)
- **Frontend + API:** Next.js (App Router) en Vercel.
- **Identidad:** npub (Nostr); login NIP-07 firmando un challenge → cookie de sesión.
- **Social:** amigos / chat / actividad viven en **relays Nostr** públicos (no en la DB).
- **Pagos (Semana 1):** Alby Hub vía NWC; Luna Negra cobra y reparte 70/30.

Detalle completo en [`PLAN.md`](./PLAN.md).
# luna-negra
