@AGENTS.md

# Luna Negra

Tienda de juegos web estilo Steam con pagos en Lightning/Nostr (sats/BTC). Ver `PLAN.md` para el plan completo del MVP (deadline 30 jun 2026, dev solo).

## Stack
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4.
- Nostr: `nostr-tools` (perfil kind:0, verificación de eventos) — NDK instalado para social.
- Lightning: `@getalby/sdk` (NWC) + `@getalby/lightning-tools` (desde Semana 1).
- DB: **Prisma 6** + **Postgres** (`provider = "postgresql"` en `prisma/schema.prisma`). En self-host corre en un contenedor del compose; ver `docker/`.
- Auth: login **NIP-07** (window.nostr) o **NIP-46** (firmador en el celu por QR), estilo NIP-98 → cookie JWT (`jose`). Lógica en `src/lib/auth.ts`, rutas en `src/app/api/auth/*`. (Existe un flujo de email/magic link en `src/app/api/auth/email`, pero **no está operativo**: el login por email no funciona.)

## Convenciones
- UI hand-rolled con Tailwind (no se usó el CLI de shadcn por fricción con Tailwind v4). Primitivos en `src/components/ui`.
- Helper de clases: `cn` en `src/lib/utils.ts` (sin clsx/tw-merge).
- Estado de sesión en cliente: `src/providers/session-provider.tsx` (`useSession`).
- Todo en español (UI y comentarios).

## Comandos
- `npm run dev` — servidor de desarrollo.
- `npx prisma migrate dev` — aplicar cambios de schema. `npx prisma studio` — ver datos.
- `npm run build` — build de producción (verificación).
