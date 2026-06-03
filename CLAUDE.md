@AGENTS.md

# Luna Negra

Tienda de juegos web estilo Steam con pagos en Lightning/Nostr (sats/BTC). Ver `PLAN.md` para el plan completo del MVP (deadline 30 jun 2026, dev solo).

## Stack
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4.
- Nostr: `nostr-tools` (perfil kind:0, verificación de eventos) — NDK instalado para social.
- Lightning: `@getalby/sdk` (NWC) + `@getalby/lightning-tools` (desde Semana 1).
- DB: **Prisma 6** + **SQLite en dev** (`prisma/dev.db`). Para prod: cambiar `provider` a `postgresql` en `prisma/schema.prisma` (Supabase/Neon).
- Auth: login **NIP-07** (window.nostr) estilo NIP-98 → cookie JWT (`jose`). Lógica en `src/lib/auth.ts`, rutas en `src/app/api/auth/*`.

## Convenciones
- UI hand-rolled con Tailwind (no se usó el CLI de shadcn por fricción con Tailwind v4). Primitivos en `src/components/ui`.
- Helper de clases: `cn` en `src/lib/utils.ts` (sin clsx/tw-merge).
- Estado de sesión en cliente: `src/providers/session-provider.tsx` (`useSession`).
- Todo en español (UI y comentarios).

## Comandos
- `npm run dev` — servidor de desarrollo.
- `npx prisma migrate dev` — aplicar cambios de schema. `npx prisma studio` — ver datos.
- `npm run build` — build de producción (verificación).
