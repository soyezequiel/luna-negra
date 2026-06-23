# Plan — API pública de "herramientas básicas" + actualización de Tetris

> Objetivo: dejar la interfaz pública de Luna Negra como un **set chico de
> herramientas consistentes y combinables** (lo charlado: identidad, perfil,
> presencia, invitación, apuesta, avisos) y **actualizar el único juego** (Tetris)
> en el mismo movimiento, sin retrocompatibilidad.
>
> Relacionado: [`api-publica.md`](api-publica.md) (contrato actual) ·
> [`api-reference.md`](api-reference.md) (interno completo) · [`public/openapi.json`](../public/openapi.json).

## Contexto y decisiones de base

- **Pre-launch, un solo juego.** El único consumidor real es **Tetris**
  (`F:\proyectos\tetris`). No hay que mantener versiones viejas.
- **Sin retrocompatibilidad.** Cambio limpio: se renombra/elimina sin alias, y se
  actualiza Tetris en lockstep. Mismo dueño en los dos repos → se despliegan juntos.
- **Tetris ya hostea lo suyo.** Tiene su **propio** backend de salas, presencia y
  leaderboard (`src/online/roomService.ts`, `api/rooms/*`, `api/leaderboard.ts`).
  Usa Luna Negra solo para: **identidad** (`/api/v1/session`, `/api/v1/rooms/verify`),
  **capa social** (amigos / invitar / launch-request), **apuestas** y **webhooks**.
- **Consecuencia de diseño:** Luna Negra **no** necesita construir "sala con estado
  compartido" ni "marcador" — ningún juego los usa. Construir endpoints especulativos
  contradice el principio de "herramientas que el juego realmente usa". → **Diferidos**
  (ver final).

## Principio rector: una sola forma de todo

La meta declarada es que sea **fácil de aprender**. La forma de lograrlo no es agregar
features, es **quitar variantes**: un vocabulario de estados, un set de eventos, errores
con código estable, sin cachés sorpresa.

> **Métrica de éxito:** cuánto **código defensivo de Tetris podemos borrar**. Hoy el
> cliente arrastra ~570 líneas que existen *solo* porque la API es inconsistente.

## Evidencia: qué duele hoy (tomado del cliente de Tetris)

| Síntoma en Tetris | Archivo | Causa raíz en la API |
|---|---|---|
| `normalizeBetStatus` / `normalizeDepositStatus` con ~10 sinónimos cada uno | `src/online/lunaNegraBets.ts` | El estado de apuesta/depósito se reporta con palabras distintas según endpoint |
| `fetchDetailAndDeposits` (dos GET + merge por npub) | `src/online/lunaNegraBets.ts` | Estado y handles de pago viven en endpoints separados |
| `_cb=Date.now()` + `cache-control:no-cache` en cada GET; webhook con "actualización optimista" | `lunaNegraBets.ts`, `lunaNegraSocial.ts`, `api/webhooks/luna-negra.ts` | Los GET de apuesta se cachean ~3 min |
| `depositEventIsPaid` (regex sobre el `type` del evento) | `api/webhooks/luna-negra.ts` | Nombres de evento de webhook inestables |
| `errorLooksResolved` (adivina por código/mensaje si ya estaba resuelta) | `lunaNegraBets.ts` | Códigos de error de `/result` sin documentar; no idempotente |
| `unwrapEnvelope` | `lunaNegraSocial.ts` | **Falso positivo**: el envelope ya es uniforme (`apiOk` devuelve crudo). Se borra. |
| Fallbacks "mock" + comentario "los endpoints TODAVÍA NO EXISTEN" | `lunaNegraSocial.ts` | Comentario stale: `/session`, `/friends`, `/presence` ya existen |

---

## La API pública resultante (las herramientas)

| Herramienta | Endpoints | Acción |
|---|---|---|
| **Identidad** | `GET /api/v1/session`, `GET /api/v1/rooms/verify`, `/.well-known/jwks.json` | **Mantener** (estandarizar shape de identidad) |
| **Perfil** | `GET /api/v1/players/{npub}/profile` | **Mantener** |
| **Presencia** | `POST /api/v1/presence`, `GET /api/v1/friends` | **Generalizar** (bolsa `state` libre + `status` reservado) |
| **Invitación** | `POST /api/v1/invites`, `GET /api/v1/invites` | **Unificar** `friends/invite` + `launch-requests` en un recurso |
| **Apuesta** | `POST /api/v1/bets`, `GET /api/v1/bets/{id}`, `/cancel`, `/result` | **Limpiar** (vocabulario único, handles dentro del detalle, sin caché, idempotente) |
| **Avisos** | `GET/POST /api/v1/provider/webhook` + eventos | **Estabilizar** (nombres finales, payload uniforme) |
| **Actividad** | `POST /api/v1/games/{slug}/activity` | **Mantener** |
| **Sala (estado)** | `GET/POST /api/v1/rooms/{roomId}/state` | **Construir** — bolsa key/value compartida, para juegos sin backend |
| **Marcador** | `GET/POST /api/v1/leaderboards/{name}` | **Construir** — store de puntajes con nombre |

---

## Fases

### Fase 0 — Congelar el contrato (definiciones, sin código)
Decidir y escribir, una sola vez, el vocabulario canónico:

- **Estado de apuesta (único, público):** `pending_deposits | funded | settled | cancelled | expired | refunded`. Eliminar el alias interno `ready` de toda salida pública (hoy el escrow interno usa `ready`).
- **Estado de depósito (único):** `pending | paid | refunded | failed`.
- **Eventos de webhook (finales):** `purchase.completed`, `deposit.received`, `bet.funded`, `bet.settled`, `bet.cancelled`, `bet.expired`, `bet.refunded`, `payout.sent`. **Un solo** evento de depósito pagado (`deposit.received`); quitar el alias `bet.ready`.
- **Errores estables de `/result`:** `ALREADY_RESOLVED`, `NOT_READY`, `CONTRACT_MISMATCH`, `ORACLE_NOT_PROVISIONED`, `BAD_WINNERS`, `WRONG_SIGNER`, `FORBIDDEN`. Documentados en OpenAPI.
- **Envelope:** ya es uniforme (objeto crudo + `{ error: { code, message } }`). **No cambia.**

**Decisiones a confirmar** (mi recomendación marcada):
1. *Handles de pago dentro del detalle* — fusionar `GET /bets/{id}/deposits` dentro de `GET /bets/{id}` (cada participante trae `bolt11/lnurl/payUrl`). **Recomiendo sí**: elimina los dos-GET-y-merge de Tetris. (`/deposits` desaparece.)
2. *Recurso de invitación* — renombrar a `POST /api/v1/invites` (crear) + `GET /api/v1/invites?npub=` (pendientes), retirando `friends/invite` y `launch-requests`. **Recomiendo sí.**
3. *Caché* — fijar `Cache-Control: no-store` en los GET de apuesta. **Recomiendo sí** (mata el `_cb` y la actualización optimista del webhook).

### Fase 1 — Identidad y perfil (mínimo)
- Confirmar que `/session` y `/rooms/verify` devuelven el mismo bloque de identidad
  (`npub`, `pubkey`, `displayName`, `avatarUrl`). Sin cambios funcionales esperados.
- Archivos: `src/app/api/v1/session/route.ts`, `src/app/api/v1/rooms/verify/route.ts`,
  `src/app/api/v1/players/[npub]/profile/route.ts`.

### Fase 2 — Unificar invitaciones (la gran reducción de superficie)
- **Hoy (público):** `POST /api/v1/friends/invite` + `GET /api/v1/launch-requests`.
  Conceptualmente son una herramienta: "invitar npub a una sala" + "¿qué lanzamiento
  tengo pendiente?".
- **Nuevo:** `POST /api/v1/invites` (body `{ fromNpub, toNpub, roomId, inviteUrl, gameId? }`)
  y `GET /api/v1/invites?npub=` (devuelve el launch pendiente). Misma lógica, un solo nombre.
- Eliminar las rutas viejas (sin alias).
- *Nota:* las rutas **internas** de invitación con cookie (`/api/invites`,
  `/api/games/[id]/rooms`, `/api/rooms/join`) son first-party de la web de Luna Negra,
  **no** son contrato público → fuera de alcance (se pueden simplificar aparte).
- Archivos: crear `src/app/api/v1/invites/route.ts`; borrar
  `src/app/api/v1/friends/invite/route.ts` y `src/app/api/v1/launch-requests/route.ts`.

### Fase 3 — Presencia genérica
- `POST /api/v1/presence`: mantener `status` (reservado: `online | in-game`) y `roomId`,
  y **agregar** una bolsa libre opcional `state: { … }` (puntaje, vidas, equipo…).
- `GET /api/v1/friends`: incluir el `state` de cada amigo (además de `presence`/`roomId`).
- Tetris hoy solo manda `status`+`roomId`: sigue andando sin cambios; el `state` queda
  disponible para futuros juegos.
- Archivos: `src/app/api/v1/presence/route.ts`, `src/app/api/v1/friends/route.ts`,
  `src/lib/social.ts`.

### Fase 4 — Apuestas consistentes (el corazón; tocar con cuidado: hay plata)
- **Un solo vocabulario** de estado en toda salida (quitar `ready`, sinónimos, etc.).
- **Handles dentro del detalle:** `GET /api/v1/bets/{id}` devuelve `participants[]` con
  `depositStatus` + `bolt11/lnurl/payUrl`. Borrar `GET /bets/{id}/deposits`.
- **`POST /api/v1/bets/{id}/result` idempotente:** re-reportar el mismo ganador devuelve
  `200 { ok:true, alreadyResolved:true }` en vez de error → mata `errorLooksResolved`.
- **Sin caché:** `Cache-Control: no-store` en los GET de apuesta.
- **Invariante intacta:** el contrato se sigue publicando firmado en Nostr y se
  verifica `CONTRACT_MISMATCH` antes de pagar. Mantener los tests de escrow.
- Archivos: `src/app/api/v1/bets/route.ts`, `src/app/api/v1/bets/[id]/route.ts`,
  `src/app/api/v1/bets/[id]/deposits/route.ts` (borrar), `.../result/route.ts`,
  `.../cancel/route.ts`; helpers de `src/lib/escrow-*`.

### Fase 5 — Webhooks estables
- Emitir **solo** los nombres finales (Fase 0); un único `deposit.received`.
- Todo evento de apuesta incluye `data.roomId` y `data.metadata` (ya pasa, verificar).
- Archivos: `src/lib/webhooks.ts`.

### Fase 6 — Actualizar Tetris (lockstep, sin retrocompat)
En `F:\proyectos\tetris`, reescribir contra el contrato limpio y **borrar la capa defensiva**:

- `src/online/lunaNegraBets.ts`:
  - Borrar `normalizeBetStatus`/`normalizeDepositStatus` (usar el vocabulario único directo).
  - Borrar `fetchDetailAndDeposits` → un solo `GET /bets/{id}`.
  - Borrar `errorLooksResolved` → usar `alreadyResolved` de la respuesta idempotente.
  - Borrar el `_cb`/`no-cache` de cada fetch.
- `src/online/lunaNegraSocial.ts`:
  - Borrar `unwrapEnvelope` y los fallbacks "mock"; actualizar comentarios stale.
  - Apuntar invitaciones/launch al nuevo `/api/v1/invites`.
- `api/webhooks/luna-negra.ts`:
  - Borrar `depositEventIsPaid` (regex) y la "actualización optimista"; reaccionar a los
    nombres de evento finales.
- `api/luna-negra/[action].ts`, `api/bets/[action].ts`, `api/rooms/luna-negra/enter.ts`:
  alinear a los endpoints/paths nuevos.
- Actualizar `docs/luna-negra-social-spec.md` del repo de Tetris.

### Fase 7 — Sala con estado compartido (primitiva nueva, para el próximo juego)
Para juegos **sin backend propio** (un cliente estático, como el demo): Luna Negra
hostea el "tablero común". Se construye **genérica** (bolsa key/value, estilo
`SetLobbyData` de Steam), no a medida de un juego.

- **Auth = jugador** (Bearer invite/entitlement), **no** API key: el cliente del juego
  escribe sin servidor propio. Reusa el patrón que ya tiene `/api/v1/rooms/{roomId}/presence`.
- **Datos compartidos de la sala:** `POST /api/v1/rooms/{roomId}/state` con
  `{ set: { clave: valor, … } }` (last-write-wins por clave; `version` opcional para
  concurrencia optimista). `GET /api/v1/rooms/{roomId}/state` → `{ data, version, members }`,
  con `members[]` trayendo el `state` por jugador (de Fase 3). Polling con `version`/ETag
  para que el GET sea barato.
- **Significado lo decide el juego:** la plataforma no interpreta las claves (tablero,
  pregunta actual, config, turno…).
- **No reemplaza** lo de Tetris: Tetris sigue con su backend; esta primitiva es para el
  juego que no tiene uno.
- Archivos nuevos: `src/app/api/v1/rooms/[roomId]/state/route.ts` + store en `src/lib/`
  (TTL corto, como la presencia). Validar tamaño máximo de la bolsa.

### Fase 8 — Marcador / leaderboard (primitiva nueva)
Store de puntajes con nombre, genérico y por proveedor/juego.

- **Subir:** `POST /api/v1/leaderboards/{name}/scores` con `{ score }`, auth = jugador
  (Bearer entitlement). Política "se queda el mejor". `{name}` lo elige el juego
  (`semanal`, `clasico`, …).
- **Leer:** `GET /api/v1/leaderboards/{name}?window=all|week&view=top|around&npub=`
  → `{ entries: [{ npub, displayName, score, rank }] }`.
- **Anti-trampa (importante):** un puntaje enviado por el **cliente es falsificable**.
  Sirve para **mostrar** rankings (igual que Steam), **NO** para resolver apuestas — el
  resultado de una apuesta sigue viniendo del game server por `/result`. Dejar esto
  escrito en los docs.
- Archivos nuevos: `src/app/api/v1/leaderboards/[name]/route.ts` (+ `/scores`), modelo
  `Leaderboard`/`Score` en `prisma/schema.prisma` + migración.

> **Cuidado (especulativo):** ningún juego de hoy las usa. Antes de construirlas,
> bocetar el "próximo juego" concreto (p. ej. un por-turnos) y validar que la bolsa
> key/value y el leaderboard le alcanzan. Mantenerlas **genéricas**: si terminan con
> campos a medida de un juego, dejaron de ser primitivas.

### Fase 9 — Docs / SDK como fuente de verdad
- Actualizar [`api-publica.md`](api-publica.md), [`public/openapi.json`](../public/openapi.json)
  y [`sdk/index.ts`](../sdk/index.ts) al contrato final (incluido `/invites`, presencia con
  `state`, detalle con handles, **sala-estado** y **marcador**).

## Riesgos y cuidados

- **Plata (Fase 4):** el refactor toca escrow. Mantener invariante Nostr
  (`publishContract` + `CONTRACT_MISMATCH`) y los tests de pago/reembolso. No tocar la
  máquina de estados interna del tick, solo la **forma de salida**.
- **Despliegue acoplado:** al no haber retrocompat, Luna Negra y Tetris deben subir
  juntos. Ventana corta de incompatibilidad aceptable (pre-launch, mismo dueño).
- **Caché/CDN:** confirmar de dónde viene el cacheo de ~3 min (Cloudflare/headers) antes de
  declararlo resuelto con `no-store`.

## Orden sugerido (ROI para dev solo)

**Bloque A — camino crítico (lo que necesita el juego real, Tetris):**
1. **Fase 0** (definiciones) — barato, desbloquea todo.
2. **Fase 4 + 5** (apuestas + webhooks) — máximo borrado de código defensivo en Tetris.
3. **Fase 2** (unificar invitaciones) — reduce superficie visible.
4. **Fase 3** (presencia `state`) — chico, y prepara la sala-estado.
5. **Fase 6** (Tetris) — en lockstep con cada fase de arriba.

**Bloque B — primitivas para el próximo juego (después del bloque A, no bloquea el deadline):**
6. **Fase 7** (sala con estado compartido).
7. **Fase 8** (marcador).

**Cierre:**
8. **Fase 9** (docs/SDK) — refleja todo lo anterior.

## Checklist

- [x] Fase 0: vocabulario de estados, eventos y errores escritos en OpenAPI.
- [x] Fase 1: identidad/perfil verificados.
- [x] Fase 2: `/api/v1/invites` creado; `friends/invite` + `launch-requests` borrados.
- [x] Fase 3: presencia con `state`; `friends` expone `state`.
- [x] Fase 4: detalle con handles; `/deposits` borrado; `/result` idempotente; sin caché; tests de escrow verdes.
- [x] Fase 5: webhooks con nombres finales (sin alias `bet.ready`); payload con `roomId`/`metadata`. Handler de Tetris simplificado (refresh directo); `depositEventIsPaid` + actualización optimista borrados.
- [x] Fase 6: Tetris actualizado; capa defensiva borrada (normalizeBetStatus/Deposit, errorLooksResolved, isResolvedFromLuna, mergeDepositStatus, fetchDetailAndDeposits, unwrapEnvelope, _cb/no-cache, modo mock completo + store de presencia); tsc limpio + 166 tests verdes.
- [x] Fase 7: `GET/POST /api/v1/rooms/{roomId}/state` (bolsa compartida key/value + estado por jugador en `members[]`, auth = jugador con Bearer invite; LWW por clave + `version` CAS opcional; ETag/304; TTL 60s). Store en `src/lib/room-state.ts`; modelos `RoomState`/`RoomMemberState` + migración `20260613140000_room_state` (sin aplicar). 11 tests; 143 verdes + tsc limpio.
- [x] Fase 8: `GET /api/v1/leaderboards/{name}` + `POST .../scores` (auth Bearer entitlement; "se queda el mejor"; window all|week, view top|around). Modelos `Leaderboard`/`Score` + migración `20260613150000_leaderboard` (sin aplicar); store en `src/lib/leaderboard.ts`. Nota anti-trampa en `api-publica.md`. 9 tests; 152 verdes + tsc limpio.
- [x] Fase 9: `api-publica.md`, `openapi.json`, `sdk/index.ts` al día. OpenAPI: borrado `/deposits`; handles + `depositsReceived/Total` en `BetDetail`; `/result` 200 con `alreadyResolved`/`status`; agregados `/session`, `/presence`, `/friends`, `/invites`, `/rooms/{roomId}/state`, `/leaderboards/{name}` (+`/scores`) con sus schemas. SDK: borrado `getBetDeposits`/`BetDeposits`/`DepositHandle`; handles en `BetParticipantView`; counts en `BetDetail`; `reportWinners` devuelve `alreadyResolved?`/`status?`. `api-reference.md`: sumadas sala-estado y marcador. OpenAPI válido (18 paths) + tsc limpio.
