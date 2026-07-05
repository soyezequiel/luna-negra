# Planes: datos de juego que Luna Negra puede integrar y todavía no muestra

Cinco features para enriquecer la ficha del juego con datos que ya entran (o
casi) por la integración. **Prioridad por Nostr Games Protocol (NGP)**: primero lo que se
apoya en eventos Nostr firmados (NIP-38, kind:31337, kind:1/NIP-23), después lo
que es puramente REST 1.0.

Orden de ataque sugerido:

| # | Feature | Pata NGP | Esfuerzo | Prioridad |
|---|---------|----------|----------|-----------|
| 5 | Puntaje personal / ranking propio | kind:31337 (fuerte) | S | **P1** |
| 4 | Agregado de reseñas | kind:1 / NIP-23 (fuerte) | S | **P1** |
| 1 | "Jugando ahora" (jugadores en vivo) | NIP-38 kind:30315 (fuerte) | M | **P1** |
| 2 | Estado in-game (`stateJson`) | débil (NIP-38 es solo texto) | M | P2 |
| 3 | Tiempo jugado / sesiones | casi nula | M | P3 |

---

## Plan 5 — Puntaje personal y puesto propio (P1, NGP-first)

**Objetivo.** En la ficha, además del top, mostrarle a cada jugador *"Tu mejor:
4.200 · puesto #7 de 312"* por cada tabla. Es la extensión más barata de la
infra NGP que ya existe.

**Por qué es NGP.** El récord se firma como `kind:31337` y `score-sync.ts` lo
proyecta a la tabla `Score` con `sourceEventId`/`sourcePubkey`. El read-model ya
distingue procedencia (`viaNostr`). No hay que tocar el camino de escritura:
solo leer el puesto del jugador logueado.

**Cambios.**
- `src/lib/leaderboard.ts`: ya existe `readLeaderboard(..., view: "around", npub)`
  que devuelve la vecindad + rank. Falta un helper público liviano
  `readPlayerStanding(gameId, npub)` que, por cada tabla del juego, devuelva
  `{ board, score, rank, total, viaNostr }` usando el mismo `count(score > best)`
  de `submitScore`.
- Endpoint: extender `GET /api/scores/top` con `?me=1` (usa la sesión) o un
  `GET /api/scores/me?gameId=` que devuelva el standing por tabla. Reutiliza
  `getSession()` → `npub`.
- UI: en `src/components/score-leaderboard.tsx`, bajo cada tabla, una fila
  fijada "Vos" con medalla/rank y el ⚡ si el récord vino por Nostr. Si el
  jugador no tiene score en esa tabla, CTA sutil "Todavía no jugaste esta tabla".

**Riesgos / notas.** Ranking sobre `MAX_SCAN=5000` ya acotado. El puntaje es
falsificable (lo firma el cliente) — mismo disclaimer que hoy; no se usa para
premios. Esfuerzo: **S** (un helper + un endpoint + fila en un componente).

---

## Plan 4 — Agregado de reseñas visible y reconstruible desde Nostr (P1, NGP-first)

**Objetivo.** Mostrar el resumen tipo Steam *"Muy positivas · 4,6 ★ (87)"* en el
**header de la ficha** y en la **`GameCard`**, no solo enterrado en la sección de
reseñas.

**Por qué es NGP.** Las reseñas ya se publican como evento Nostr firmado por el
usuario (`publishGameReview` → `kind:1` colgando de la coordenada del juego, tag
`a`). Hoy el agregado (`average`, `count`) sale solo de la tabla `Review` (1.0).
El plan agrega la **reconstrucción desde Nostr**, igual que `comment-sync.ts`
cachea los `kind:1`: un `review-sync` que levante las reseñas firmadas ancladas a
la coordenada, parseé el rating (tag `rating` o estrellas en el contenido) y las
concilie en `Review`/`GameComment` con `sourceEventId`. Así el rating promedio es
reconstruible desde relays y no depende solo del POST a la DB.

**Cambios.**
- NGP: `src/lib/review-sync.ts` (patrón `comment-sync.ts`): query `kinds:[1]`,
  `#a: [coords]`, filtra los que traen rating, dedup por `eventId`, upsert en
  `Review` con procedencia. Schedule en `instrumentation.ts` (junto a
  score/comment-sync). Definir el tag de rating en `publishGameReview` si aún no
  lo emite (agregar `["rating","1".."5"]`).
- Agregado: helper `getReviewSummary(gameId)` → `{ average, count, label }` con
  el label curado ("Muy positivas" ≥ 4,5; "Positivas" ≥ 3,5; etc.).
- UI: badge en el header de `src/app/game/[slug]/page.tsx` (al lado de
  categorías) y en `src/components/game-card.tsx`. Cachear en `store-catalog` para
  no pegarle a la DB por cada card del home.

**Riesgos / notas.** Requiere que `publishGameReview` incluya el rating como tag
para que sea parseable desde Nostr (hoy va embebido en el texto/estrellas —
verificar). Esfuerzo: **S–M** (sync nuevo + agregado + 2 badges).

---

## Plan 1 — "Jugando ahora" en la ficha, derivado de NIP-38 (P1, NGP-first)

**Objetivo.** Contador estilo SteamDB en la ficha y un badge en la card:
*"142 jugando ahora · pico hoy 380"*.

**Por qué es NGP.** La presencia "jugando X" ya existe como `kind:30315` (NIP-38)
firmada por el propio jugador y anclada a la coordenada del juego
(`hasStoreGameCoord` en `nostr-social.ts`). Para los juegos NGP nativos (que no
reportan por REST) esa es la ÚNICA fuente. El plan agrega un **presence-sync NGP**
que cuenta esos eventos frescos por coordenada — calcado de `score-sync.ts`.

**Cambios.**
- NGP: `src/lib/live-presence-sync.ts`: cada ~30 s, `querySync({ kinds:[30315],
  "#a":[coords] })`, quedarse con el último evento por pubkey, descartar vencidos
  (NIP-40) y no-frescos, y contar npubs por juego. Persistir el conteo instantáneo
  en un caché en memoria (`Map<gameId, {count, at}>`) + una fila
  `PlayerCountSample(source:"live-2.0")` para el histórico.
- 1.0: para juegos que integraron `POST /api/v1/presence`, ya hay `GamePresence`
  fresco. Unificar: `getLivePlayers(gameId)` = npubs frescos de `GamePresence`
  (por `providerId`+`gameId`) ∪ conteo NGP del caché.
- Pico de hoy: `max(count)` sobre `PlayerCountSample` del día (ya se muestrea en
  `presence-sampler.ts`).
- Endpoint público `GET /api/games/[gameId]/live` → `{ now, peakToday }`.
  Cache-Control corto; sirve a anónimos sin tocar Neon en cada hit.
- UI: `<LivePlayers gameId>` en la columna de metadatos de la ficha
  (`src/app/game/[slug]/page.tsx`) y un puntito verde con número en `game-card.tsx`.

**Riesgos / notas.** `GamePresence` se llavea por `(providerId, npub)` y el
`gameId` puede ser null (integraciones viejas): esos caen a un conteo
provider-wide, documentarlo. Costo de relay del sync NGP: acotado a coordenadas de
juegos publicados, igual que score-sync. Esfuerzo: **M**.

---

## Plan 2 — Estado in-game (`GamePresence.stateJson`) en la presencia social (P2)

**Objetivo.** Enriquecer la presencia de amigos: en vez de "Jugando Tetris",
mostrar *"Jugando Tetris — nivel 7, 12.400 pts"* cuando el juego reporta estado.

**Por qué NO es NGP fuerte.** El estado rico vive en `GamePresence.stateJson`
(bolsa libre JSON del heartbeat REST §3, 1.0). En NGP el `kind:30315` lleva solo
`content` de texto libre ("Jugando X en Luna Negra") — se podría enriquecer el
texto, pero no hay un esquema de estado firmado. Por eso es P2 y la pata NGP es
opcional (formatear un `content` más rico al publicar).

**Cambios.**
- Definir un mini-contrato del `stateJson` renderizable (claves sugeridas:
  `label`, `score`, `level`) en la guía de integración; el resto se ignora.
- `GET /api/me/playing` y el riel de amigos: exponer `stateLabel` derivado del
  `stateJson` (sanitizado, longitud acotada) para el usuario y sus amigos.
- Presencia NGP (opcional): en `publishPlayingStatus`, aceptar un `stateLabel`
  para que el `content` del `kind:30315` diga "Jugando X — nivel 7" (sigue siendo
  texto, lo lee cualquier cliente Nostr).
- UI: `friends-sidebar.tsx` / `friends-chat-panel.tsx` muestran el sublabel.

**Riesgos / notas.** `stateJson` es input del proveedor → sanitizar y truncar
estricto (XSS / spam). Sin contrato mínimo no hay nada que mostrar de forma
consistente. Esfuerzo: **M**.

---

## Plan 3 — Tiempo jugado / sesiones (P3, casi sin NGP)

**Objetivo.** *"12 h en tu registro"* por jugador y *"sesión media 8 min"* por
juego, estilo Steam.

**Por qué es lo último.** No hay NGP real: NIP-38 no da duración fiable. La fuente
es 1.0 y hoy es deliberadamente pobre — `play-click.ts` guarda **puntos discretos**
de apertura y NO inventa duración de sesión sin heartbeat. Medir tiempo jugado
requiere infra nueva de sesiones.

**Cambios.**
- Modelo `PlaySession { gameId, npub, startedAt, endedAt?, lastBeatAt }` poblado
  por el heartbeat de presencia (`POST /api/v1/presence`): abre al primer beat,
  cierra por TTL sin beats. Solo para juegos que integraron §3 (los de clicks
  quedan como puntos, sin tiempo — ya documentado).
- Agregados: `sum(endedAt-startedAt)` por (juego, npub) = "tu tiempo"; media por
  juego para el KPI.
- UI: línea "⏱ 12 h en tu registro" en el panel de biblioteca de la ficha;
  "sesión media" en `/provider/stats` y `/admin/stats` (ya usan Recharts).

**Riesgos / notas.** Cierre de sesión por expiración de TTL puede sobrestimar
(jugador que se fue con la pestaña abierta) — acotar la sesión al último beat +
gracia. Solo cubre juegos con presencia real integrada. Esfuerzo: **M** (modelo +
lifecycle + agregados).

---

### Dependencias transversales
- Los tres syncs NGP nuevos (review, live-presence) siguen el patrón in-process de
  `instrumentation.ts` + cursor en memoria (self-host, una instancia). Si algún día
  hay más de una instancia, mover cursores a DB.
- Badges de card (reseñas, jugando ahora) deben cachearse en `store-catalog` para
  no multiplicar queries en el home.
