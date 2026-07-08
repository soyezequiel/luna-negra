# Convivencia 1.0 ↔ NGP dentro de Luna Negra

> ⚠️ **Nostr Games Protocol (NGP) está EN CONSTRUCCIÓN** — mejora experimental, **no prometida**,
> trabajo **post-hackathon** (el proyecto se sigue desarrollando). Hoy lo garantizado
> es la **1.0 (REST, §1–§8)**. Ver [`nostr-games-protocol.md`](nostr-games-protocol.md).

> Cómo encaja la [Nostr Games Protocol (NGP)](nostr-games-protocol.md) en el código actual
> **sin romper la 1.0 REST**. La idea central: NGP no es un subsistema nuevo,
> es **un sync in-process más** con la misma forma que `zap-sync` / `game-sync` /
> `comment-sync`, escribiendo en las **mismas tablas** que ya alimentan la UI.

## 0. Capas del código NGP (protocolo separado del programa)

El código NGP de apuestas está estratificado con frontera dura:

| Capa | Módulos | Regla |
|---|---|---|
| **Protocolo (puro)** | `src/lib/ngp-kinds.ts` (kinds congelados), `src/lib/ngp-events.ts` (templates 31340/terms), `buildResultEventTemplateV2` en `src/lib/escrow-v2.ts` (template 1341) | Sin prisma, sin I/O, sin env. Cambiar esto = cambiar el protocolo. |
| **Servicios** | `ngp-bet-state.ts` (publica la sombra), `ngp-bet-ingest.ts` (ingiere 1339), `ngp-bet-result-sync.ts` (ingiere 1341) | Leen DB/relays, mapean a datos planos y llaman a los builders puros. |
| **Producto** | notas `kind:1` humanas (`publishSettleNoteFor`, texto del ancla), umbrales editoriales | Puede cambiar sin tocar la spec. |

Del lado juego, Tetris espeja lo mismo: `sdk/ngp.ts` (protocolo puro: reto NIP-17,
presencia NIP-38, marcador 31337) y los puertos `src/online/nostr*.ts`.

---

## 1. El principio: dos escritores, un mismo read-model

El marcador hoy es un **caché** (`Score` + `Leaderboard`) que
[`readLeaderboard()`](../src/lib/leaderboard.ts) sirve a la UI. Hoy lo escribe un
solo camino: `submitScore()` vía REST.

NGP agrega un **segundo escritor** que reconcilia eventos Nostr hacia la misma
tabla. La UI no se entera: sigue leyendo `Score`.

```
1.0 (REST):
  juego ──POST /api/v1/leaderboards/{name}/scores──▶ submitScore() ──▶ [Score] ──┐
                                                                                  ├─▶ readLeaderboard() ─▶ UI
NGP:
  cliente del jugador ──firma kind:31337──▶ relays ──▶ score-sync (tick) ─────────┘
                                                         └─ verifica firma, mapea a→gameId,
                                                            reusa submitScore() + sourceEventId
```

Esto es **exactamente** el patrón que ya usás:
[`game-sync.ts`](../src/lib/game-sync.ts) trata la DB como "caché write-through
reconstruible desde Nostr". El marcador NGP hace lo mismo para los puntajes.

---

## 2. La pieza nueva: `src/lib/score-sync.ts`

Calcado de [`zap-sync.ts`](../src/lib/zap-sync.ts). Pseudocódigo del tick:

```ts
export const SCORE_SYNC_INTERVAL_MS = Number(process.env.SCORE_SYNC_INTERVAL_MS ?? 60_000);
const SCORE_KIND = 31337;

export async function syncScores(): Promise<void> {
  const storePubkey = getStorePubkey();
  if (!storePubkey) return;

  // 1) Mapa coordenada → gameId. Los artículos los firma la tienda, así que la
  //    coordenada es 30023:storePubkey:slug (gameArticleCoord). game-sync ya
  //    mantiene Game.slug ↔ Game.id; acá solo armamos el índice inverso.
  const games = await prisma.game.findMany({
    where: { status: "published", slug: { not: null } },
    select: { id: true, slug: true },
  });
  const byCoord = new Map(
    games.map((g) => [gameArticleCoord(storePubkey, g.slug!), g.id]),
  );
  if (byCoord.size === 0) return;

  // 2) Traer scores firmados por jugadores que tageen alguno de nuestros juegos.
  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);
  const events = await pool().querySync(
    RELAYS,
    { kinds: [SCORE_KIND], "#a": [...byCoord.keys()], ...(since ? { since } : {}) },
    { maxWait: 5000 },
  );

  // 3) Reconciliar: verificar firma, mapear, "se queda el mejor".
  for (const ev of events) {
    try {
      if (!verifyEvent(ev)) continue;                 // anti-forja
      const coord = ev.tags.find((t) => t[0] === "a")?.[1];
      const gameId = coord && byCoord.get(coord);
      if (!gameId) continue;
      const board = ev.tags.find((t) => t[0] === "board")?.[1] ?? "clasico";
      const score = Number(ev.tags.find((t) => t[0] === "score")?.[1]);
      const npub = nip19.npubEncode(ev.pubkey);
      await submitScoreFromNostr(gameId, board, npub, score, ev.id, ev.pubkey);
    } catch { /* evento inválido: seguimos */ }
  }
  lastCheckedAt = startedAt;
}
```

`submitScoreFromNostr` es `submitScore()` + persistir el origen (ver §3). Misma
política "se queda el mejor", mismos límites (`MAX_SCORE`, `INVALID_NAME`).

Registro en [`instrumentation.ts`](../src/instrumentation.ts), idéntico a los
otros: `startScoreSync()` con `setTimeout` + `setInterval`, guard de
`phase-production-build`, flag `running` para no encimar corridas.

---

## 3. Cambio de schema (mínimo)

Solo se agrega **procedencia** a `Score`. Nada se renombra ni se rompe.

```prisma
model Score {
  // …campos actuales…
  sourceEventId String?  // id del kind:31337 origen. null = vino por REST 1.0
  sourcePubkey  String?  // hex que firmó (para mapear / atestación verificada)

  @@unique([leaderboardId, npub])
  @@index([leaderboardId, score])
  @@index([sourceEventId])      // dedup idempotente del sync
}
```

- `Leaderboard` **no cambia**: el `board` del evento mapea a `Leaderboard.name`,
  y la coordenada mapea a `gameId` (resuelto en el sync). La clave
  `@@unique([gameId, name])` ya sirve.
- **Idempotencia**: el sync reconcilia por keep-best (mismo `npub`+`board` → una
  fila). Re-correr no duplica. `sourceEventId` guarda el último evento Nostr que
  fijó el récord (auditoría + base para el tier verificado).

---

## 4. Anti-doble-conteo (lo importante de la convivencia)

Un juego puede mandar el mismo puntaje **por los dos caminos** (REST y Nostr). No
hay problema: `Score` es **una fila por jugador por tabla** (`@@unique`), no una
suma. "Se queda el mejor" colapsa ambos a un solo récord. El que gane es el más
alto, venga de donde venga. `sourceEventId != null` indica que el vigente entró
por Nostr; `null`, por REST.

---

## 5. Quién firma el evento NGP (dos caminos)

| Camino | Quién firma | Requiere a Luna Negra | Para |
|---|---|---|---|
| **A — juego NGP nativo** | el propio juego con su NIP-07/46 | ❌ No | pacman, sammer, bitbybit (ya firman) |

**Decisión:** se va por el **camino A** y los juegos se migran de a poco a firmar
su propio `kind:31337`. El "espejo desde la pestaña" (que la tienda firmara el
score por el jugador cuando llega por REST, al estilo
[`playing-presence.ts`](../src/lib/playing-presence.ts)) **queda descartado**: dependía
de tener la pestaña de la tienda abierta y daba menos resiliencia que A. Mientras
un juego no migre, su marcador sigue viviendo en la tabla `Score` vía REST 1.0
(sin réplica en Nostr) — y cuando migra a A, `score-sync` lo empieza a recoger solo.

---

## 6. Lo que NO cambia

- **`readLeaderboard()` y toda la UI del marcador**: intactos. Leen `Score`.
- **Endpoints REST `/api/v1/leaderboards/*`**: intactos. La 1.0 sigue siendo
  válida; NGP solo agrega un alimentador.
- **Escrow / apuestas**: intactos. Siguen centralizados (custodia). Ya emiten el
  evento de resultado firmado por el oráculo
  ([`oracle-keys.ts`](../src/lib/oracle-keys.ts), `buildResultEvent`/`reportResult`
  del SDK) — eso **es** el análogo verificado (§7).
- **Presencia, zaps, reseñas**: ya son Nostr; no se tocan.

---

## 7. Tier verificado (puente con el escrow)

El score firmado por el jugador (kind 31337) es **falsificable** — igual que el
§6 de la 1.0. Para marcadores con dinero, el sync puede exigir una **atestación**
(kind 31338) firmada por el **oráculo del juego**, reusando la misma infra de
oráculo que ya valida los resultados de apuestas:

```
score-sync (modo verificado):
  cuenta el kind:31337 SOLO si existe un kind:31338 del oraclePubkey del juego
  que referencie ese evento (tag `e`) con status=verified
```

`Provider.oraclePubkey` ya existe (memoria "oráculo gestionado por API key"). El
tier verificado no agrega infra nueva: es el mismo oráculo firmando scores en vez
de (o además de) resultados de apuestas.

---

## 8. El pago de resiliencia (por qué todo esto vale la pena)

Si Luna Negra desaparece:

- Los `kind:31337` siguen en los relays. Cualquier cliente reconstruye el ranking
  con `{ kinds:[31337], "#a":[coordenada] }`.
- La coordenada sigue existiendo porque el artículo `kind:30023` sigue en los
  relays.
- La DB de Luna Negra era **solo un caché** (igual que hoy `game-sync` la trata
  como reconstruible). Perderla no pierde datos: se rearma desde Nostr.

Es decir: NGP no es "otra feature", es **mover la fuente de verdad del
marcador de tu DB a los relays**, siguiendo el mismo camino que ya recorriste con
los juegos (kind:30023) y los zaps (kind:9735).

---

## 9. Checklist de implementación

Slice de marcador construido y probado e2e contra relays reales (jun 2026):

- [x] Migración Prisma: `Score.sourceEventId` + `Score.sourcePubkey` + índice
      (`20260626061238_score_nostr_source`).
- [x] `src/lib/score-sync.ts` (`syncScores` + `recordScoreEvent`, calcado de `zap-sync.ts`).
- [x] Origen en `leaderboard.ts`: `submitScore()` acepta `source?` y lo persiste.
- [x] `startScoreSync()` en `instrumentation.ts` + `SCORE_SYNC_INTERVAL_MS`.

Pendiente:

- [ ] Congelar los `kind` (31337/31338) tras chequear que no colisionen.
- [ ] (Tier verificado) score-sync condicionado a atestación del `oraclePubkey`.
- [ ] Doc dev: actualizar la guía de integración Nostr (skill `integrar-ngp-v2`)
      con el camino A — que el juego firme su propio `kind:31337`.
</content>
