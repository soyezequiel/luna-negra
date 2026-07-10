# Nostr Games Protocol (NGP) (draft)

> 📌 **La especificación canónica se mudó al repo del protocolo:**
> [Nostr-Game-Protocol/docs/spec/ngp.md](https://github.com/soyezequiel/Nostr-Game-Protocol/blob/main/docs/spec/ngp.md).
> Este documento queda como **nota de implementación de Luna Negra** (el "por
> qué" y el mapeo a este codebase). Si difieren, gana la spec del repo del
> protocolo.

> ⚠️ **EN CONSTRUCCIÓN — no usar en producción todavía.** **Nostr Games Protocol (NGP)**
> es una **mejora experimental y NO prometida**: no formaba parte del alcance del
> hackathon. Es trabajo **post-hackathon**, porque el proyecto se va a **seguir
> desarrollando** después. Lo único **garantizado y funcionando hoy** es la
> [**interfaz 1.0 (REST, §1–§8)**](api-publica.md). Salvo el marcador (kind:31339) y
> el reto 1v1 (NIP-17), que están implementados como adelanto, **el resto de NGP
> es diseño, no código**. Los `kind` propuestos pueden cambiar.

> **Qué es.** Una forma de hacer un juego compatible con Luna Negra usando
> **exclusivamente eventos Nostr**, sin depender de la API REST de Luna Negra ni
> de ningún servidor central. Lo que un juego publica con esta spec lo puede leer
> **cualquier cliente Nostr**, y sigue funcionando aunque Luna Negra desaparezca.
>
> **Relación con la 1.0.** La [API REST `/api/v1`](api-publica.md) sigue vigente y
> es la única opción para lo que **necesita un tercero confiable**: custodia de
> apuestas/escrow y verificación de compra de juego de pago. NGP corre **en
> paralelo** y cubre la capa social/identidad/reputación. No es todo-o-nada: se
> adopta por niveles. Para apuestas existe además un diseño de **escrow
> transparente** coordinado 100% por eventos (el custodio sigue siendo Luna
> Negra, pero todas sus acciones son eventos firmados verificables):
> [nostr-games-protocol-apuestas.md](nostr-games-protocol-apuestas.md).
>
> **Salas e invitaciones multijugador** (lo que en el panel 1.0 son §4 y §5) tienen
> su propio diseño Nostr —invitación NIP-17 desacoplada + sala NIP-29— en
> [nostr-games-protocol-salas-invitaciones.md](nostr-games-protocol-salas-invitaciones.md).
>
> **Estado.** Borrador. Los `kind` marcados como *(propuesto)* pueden cambiar
> hasta que se congele la v1 de la spec.

---

## 0. Por qué Nostr y no REST

| | 1.0 (REST a Luna Negra) | NGP |
|---|---|---|
| Dirección | el juego **pregunta** a Luna Negra | el jugador/juego **publica**; Luna Negra **lee** |
| Si Luna Negra cae | el juego se queda mudo | marcador e identidad siguen vivos en los relays |
| Otros clientes | no pueden leer nada | cualquier cliente Nostr lee los mismos eventos |
| Identidad del juego | `gameId` interno de Luna Negra | coordenada NIP-23 descentralizada |

El objetivo de NGP es **resiliencia + interoperabilidad**. Si tu juego solo
necesita login y marcador, esta spec te independiza de Luna Negra por completo.

---

## 1. Conceptos y anclas

### 1.1 Identidad del jugador
La pubkey Nostr del jugador (`npub` / hex). Se obtiene con **NIP-07** (extensión
de navegador) o **NIP-46** (firmador remoto por QR). El juego nunca crea cuentas
propias: usa la pubkey como `playerId` estable.

### 1.2 Identidad del juego — **la coordenada**
Cada juego se identifica por una **coordenada NIP-23**:

```
30023:<pubkey-del-dev>:<slug>
```

Es el `a`-tag del artículo (kind:30023) que describe el juego. Esta coordenada:

- **No depende de Luna Negra**: existe mientras exista el artículo en algún relay.
- Es el **ancla de todos los eventos** de esta spec (scores, presencia, actividad
  cuelgan de ella).
- Si Luna Negra publica el artículo del juego, también puede hacerlo el propio dev.

> A lo largo de esta spec, `GAME` = la coordenada del juego, p. ej.
> `30023:npub1dev…:pacman-pwa`.

---

## 2. Niveles de adopción

La spec es un **menú por niveles**. Implementá hasta donde te sirva.

| Nivel | Qué incluye | Para qué juego |
|---|---|---|
| **N0 — Identidad** | Login NIP-07/46. Nada más. | Todos. Mínimo absoluto. |
| **N1 — Marcador** | + evento de score (§3) | Juegos con puntaje (runner, arcade, partido) |
| **N2 — Social** | + presencia (§4) + actividad/reseñas (§5) | Para aparecer en perfiles y feeds |
| **N3 — Económico** | + zaps NIP-57 (§6). Compra de pago → **sigue en 1.0**; apuestas → [escrow transparente por eventos](nostr-games-protocol-apuestas.md) o 1.0 (§7) | Premios, propinas y apuestas |

**Multijugador con estado en vivo** (§8) queda **fuera del núcleo estándar**: es
posible con eventos efímeros pero su esquema lo define cada juego.

---

## 3. Marcador — evento de puntaje *(la única pieza nueva)*

Todo lo demás reusa NIPs existentes. Esto es lo único que esta spec **define**.

Un puntaje es un evento **addressable** (reemplazable con `d`), firmado **por el
jugador**, que tagea la coordenada del juego.

```jsonc
{
  "kind": 31339,                      // (propuesto) rango addressable 30000-39999
  "pubkey": "<pubkey del jugador>",   // firma el JUGADOR, no Luna Negra
  "created_at": 1719360000,
  "tags": [
    ["a", "30023:npub1dev…:pacman-pwa"],            // GAME — ancla
    ["d", "30023:npub1dev…:pacman-pwa:clasico"],    // identidad del registro
    ["board", "clasico"],                            // nombre de tabla
    ["score", "128400"],                             // entero, como string
    ["unit", "points"],                              // opcional: points|ms|goals|…
    ["client", "luna-negra"]                         // opcional: quién originó
  ],
  "content": "{\"level\":7,\"durationMs\":83400}"     // opcional: metadata libre (JSON)
}
```

### Reglas
- **`d` = `<GAME>:<board>`** → un jugador tiene exactamente **un registro por
  tabla**; el relay reemplaza el anterior automáticamente. Esto acota el
  almacenamiento (igual que hace pacman-pwa hoy: "se queda el mejor por pubkey").
- **`board`** lo elige el juego: `clasico`, `semanal`, `speedrun`… Permite varios
  rankings por juego.
- **`score`** es un entero no negativo en string. `unit` aclara el sentido
  (`ms` para speedruns donde menor es mejor; el cliente que rankea decide el orden
  según `unit`).
- El juego puede publicar **un solo registro "mejor puntaje"** (modelo simple) o
  además un **feed de intentos** con un evento regular (ver §3.2). Para un
  leaderboard alcanza con el addressable.

### 3.1 Leer el ranking (cualquier cliente)
```jsonc
// Filtro Nostr — funciona en Luna Negra o en cualquier cliente
{
  "kinds": [31339],
  "#a": ["30023:npub1dev…:pacman-pwa"],
  "#board": ["clasico"]
}
```
El cliente agrupa por `pubkey`, ordena por `score` (según `unit`) y resuelve
nombre/avatar con el kind:0 de cada jugador. **No hace falta Luna Negra.**

### 3.2 (Opcional) Feed de intentos
Si querés histórico de cada partida (no solo el mejor), publicá además un evento
**regular** (no reemplazable) con los mismos tags `a`/`score`/`board` y sin `d`.
Útil para "última partida de tus amigos". Cuesta más almacenamiento; es opcional.

### 3.3 Anti-trampa — leelo bien
El score lo firma el **cliente del jugador**: es **falsificable**, igual que el
§6 de la 1.0. Sirve para **rankings sociales**, **no** para repartir dinero. Para
un ranking "de confianza" ver §3.4.

### 3.4 (Opcional) Marcador verificado — atestación del oráculo
Para premios o rankings con dinero, se agrega un **segundo nivel**: un oráculo
(p. ej. el game server, o Luna Negra) publica una **atestación** que referencia
el score del jugador y lo co-firma.

```jsonc
{
  "kind": 31338,                      // (propuesto) atestación de score
  "pubkey": "<pubkey del oráculo>",
  "tags": [
    ["a", "30023:npub1dev…:pacman-pwa"],
    ["e", "<id del evento de score del jugador>"],  // qué score atestigua
    ["p", "<pubkey del jugador>"],
    ["score", "128400"],
    ["status", "verified"]            // verified | rejected
  ],
  "content": ""
}
```

Así conviven un **tier abierto** (firmado por el jugador, social, falsificable) y
un **tier verificado** (firmado por un oráculo, para stakes). Esto enlaza
naturalmente con el escrow de §7.

---

## 4. Presencia "jugando X" — NIP-38

El firmador del jugador publica su estado. No requiere servidor.

```jsonc
{
  "kind": 30315,                      // NIP-38 user status
  "pubkey": "<pubkey del jugador>",
  "tags": [
    ["d", "general"],
    ["a", "30023:npub1dev…:pacman-pwa"],  // a qué juego refiere
    ["expiration", "1719360300"]          // TTL: ~30-60 s
  ],
  "content": "Jugando Pac-Toshi 🎮"
}
```

Luna Negra y cualquier cliente derivan "Jugando <X>" de este evento.

> **Diferencia con la 1.0:** en 1.0 el game server reporta presencia por REST y
> Luna Negra firma. En NGP firma el **propio jugador**, así no necesita a Luna
> Negra para tener presencia. Requiere que el firmador esté disponible en el
> cliente (lo está si el login fue NIP-07/46).

---

## 5. Actividad y reseñas — NIP-23 + comentarios

Ya soportado por Luna Negra hoy. No hay nada nuevo que implementar del lado del
juego más allá de publicar:

- **Reseñas / comentarios**: kind:1 con tag `a` = `GAME` (cuelgan de la coordenada).
- **Logros / hitos** (p. ej. "completé el álbum", "gané el torneo"): un kind:1 o
  un evento de logro con tag `a` = `GAME`. Útil para figus/vesta que no encajan en
  el marcador simple.

---

## 6. Propinas y premios — NIP-57 (zaps)

Para juegos gratis o para premiar al ganador: **zap** firmado por el usuario al
dev o al ganador. bitbybit-run y figus ya usan este patrón.

- Recibo de zap (kind:9735) verificable → "top de zappers" por juego/dev.
- No requiere nada propio de Luna Negra: es NIP-57 estándar.

---

## 7. Lo que NO se puede hacer solo con eventos (se queda en 1.0)

Honestidad de diseño: **Nostr es mensajería firmada, no liquidación de dinero.**

| Caso | Por qué no es NGP puro | Qué sí publicar en Nostr |
|---|---|---|
| **Escrow / apuestas** | Retener stake y pagar al ganador exige **custodio**. Trustless real = DLCs sobre Bitcoin (fuera de alcance). | **Todo menos la custodia**: contrato firmado por el retador, depósitos como zaps, estado del escrow, resultado del oráculo y payouts — la coordinación completa por eventos, sin API REST. Diseño en [nostr-games-protocol-apuestas.md](nostr-games-protocol-apuestas.md) (kinds 1339/1341/31340). |
| **Compra de juego de pago** | Alguien tiene que **validar el pago Lightning** antes de dar acceso (el "issuer" de figus). | Un **recibo/entitlement** firmado, opcionalmente publicado, para probar la compra ante terceros. |
| **Salas con estado compartido en vivo** | Posible con efímeros (bitbybit lo hace), pero el esquema es **específico de cada juego** y la latencia de relays no da para tiempo real fino. | — (extensión opcional §8, sin esquema estándar) |

**Regla:** la **custodia** del dinero queda en un tercero (Luna Negra); NGP no
puede eliminarla, pero sí puede hacer que **toda la coordinación y la prueba**
de lo que pasó sean eventos firmados. Para apuestas, el custodio opera como
**escrow transparente**: lee contratos de relays y publica cada acción suya
como evento verificable (ver el doc de apuestas). La compra de juego de pago
sí se queda entera en la 1.0.

---

## 8. (Opcional, no estándar) Multijugador con eventos efímeros

Para juegos sin backend que igual quieren multijugador, se pueden usar eventos
**efímeros** (kind 20000–29999) tageando `GAME` y un `roomId`. bitbybit-run ya lo
hace para su carrera de 8 jugadores. **Esta spec no fija el esquema del estado**:
cada juego define sus propias claves. Documentado como extensión, no como núcleo.

---

## 9. Mapa de los juegos de referencia

| Juego | Nivel que encaja | Notas |
|---|---|---|
| **pacman-pwa** | N1 (marcador) | Ya firma scores con NIP-07; solo adopta el esquema §3 |
| **sammer** | N1 | Ya tiene `nostr-scores.html`; mismo caso |
| **bitbybit-run** | N1 + N3 | Score/resultado + ya zapea al ganador; multijugador en §8 |
| **futbolcillo** | N1 + N2 | Resultado de partido; retos por DM (NIP-17) |
| **figus** | N0 + N2 | Colección/economía con issuer (centralizado). Login + logros §5 |
| **vesta** | N0 (+ §8 propio) | Tablero con estado de turno + aleatoriedad verificable; protocolo propio |

El **núcleo simple** (N0+N1) cubre limpio a **pacman, sammer, bitbybit y
futbolcillo**. figus y vesta adoptan identidad/presencia/logros y conservan sus
protocolos custom — ahí Nostr deja de ser la herramienta correcta y está bien.

---

## 10. Checklist para el dev

- [ ] **N0** Login NIP-07/46 → obtengo la pubkey del jugador.
- [ ] Tengo la **coordenada** `GAME` (`30023:dev:slug`) del juego.
- [ ] **N1** Publico el evento de score (kind 31339) firmado por el jugador,
      tageando `GAME` y `board`.
- [ ] Leo el ranking con el filtro `{ kinds:[31339], "#a":[GAME] }`.
- [ ] **N2** (opc.) Presencia NIP-38 (kind 30315) con `expiration`.
- [ ] **N2** (opc.) Reseñas/logros kind:1 con tag `a` = `GAME`.
- [ ] **N3** (opc.) Zaps NIP-57 para propinas/premios.
- [ ] **N3** (opc.) Apuestas → escrow transparente por eventos
      ([spec aparte](nostr-games-protocol-apuestas.md)) o API v2.
- [ ] Compra de juego de pago → **API REST 1.0** (no NGP puro).

---

## Apéndice — resumen de kinds

| Kind | Qué | Origen | Estado |
|---|---|---|---|
| 0 | Perfil del jugador | NIP-01 | estándar |
| 1 | Reseñas / comentarios / logros (tag `a`=GAME) | NIP-01/23 | estándar |
| 30023 | Artículo del juego (define la coordenada) | NIP-23 | estándar |
| 30315 | Presencia "jugando X" | NIP-38 | estándar |
| 9735 | Recibo de zap (propinas/premios) | NIP-57 | estándar |
| 31339 | **Mejor puntaje del jugador** | esta spec | *propuesto* |
| 31338 | **Atestación de puntaje (oráculo)** | esta spec | *propuesto* |
| 1339 | **Contrato de apuesta** (firma el retador) | [apuestas](nostr-games-protocol-apuestas.md) | **estable (v1)** |
| 1341 | **Resultado de apuesta** (firma el oráculo; desde jul 2026 también lo firma el oráculo gestionado de Luna) | [apuestas](nostr-games-protocol-apuestas.md) | **estable (v1)** |
| 31340 | **Estado del escrow / terms** (firma el escrow; cubre también apuestas NGE salvo `visibility: unlisted`) | [apuestas](nostr-games-protocol-apuestas.md) | **estable (v1)** |
| 20000–29999 | Estado multijugador efímero (no estándar) | NIP-01 | extensión |
</content>
</invoke>
