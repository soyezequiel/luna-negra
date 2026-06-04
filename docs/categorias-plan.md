# Plan A5 · Categorías/tags en la tienda

> Esfuerzo: **S** (unas horas) · Riesgo: **bajo** · 1 migración.
> Roadmap: Fase A, ítem A5 (lo único que queda de la Fase A, marcado opcional).

## Decisión de alcance
Empezar con **una categoría curada por juego** (lista fija en código). Es el 90%
del valor para navegar la tienda y lo más simple: se filtra con un `WHERE` trivial
y no necesita UI de multi-selección. Los **tags libres** quedan como extensión opcional.

## 1. Modelo de datos
- `Game.category String?` en `prisma/schema.prisma` (nullable → los juegos
  existentes quedan sin categoría).
- Lista curada en `src/lib/categories.ts` (slug + label): `accion`, `aventura`,
  `puzzle`, `estrategia`, `arcade`, `casino`, `multijugador`, `otros`. Sirve para
  validar en el backend y renderizar los filtros.
- Migración: `npx prisma migrate dev --name game_category`
  → `ALTER TABLE "Game" ADD COLUMN "category" TEXT` (mismo patrón que `lud16`).
- *(Tags opcional más adelante:* `tags String @default("[]")` como JSON-string,
  replicando el patrón de `screenshots` para portabilidad.)

## 2. Alta y edición del proveedor
- `src/app/api/provider/games/route.ts` (POST): aceptar `category`, **validarla
  contra la lista curada** (si no está → `otros` o `null`).
- `src/app/api/provider/games/[id]/route.ts` (PATCH): misma rama de validación.
- Form del proveedor en `/provider`: un `<select>` con las categorías curadas.

## 3. Navegación en la tienda
- `src/app/page.tsx`: leer `?cat=` de `searchParams`, añadir al `where`
  (`...(cat ? { category: cat } : {})`) y propagar `cat` en `linkFor` (junto con
  `q` y `page`).
- Fila de **chips de categoría** (links que setean `?cat=` y resetean `page`).
- Badge de categoría en `/game/[slug]` y opcionalmente en `GameCard`.

## 4. Seed + tests
- Asignar categorías a los juegos de `prisma/seed.mjs`.
- Test unitario para la validación de categoría (la suite ya corre con Vitest).
