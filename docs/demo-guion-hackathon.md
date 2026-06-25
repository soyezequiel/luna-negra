# Guión del video demo — "Loop de plata" (hackathon La Crypta · Gaming)

> Objetivo: un **video corto (90–120s), en una sola toma continua**, que muestre el
> ciclo completo **identidad Nostr → jugar → mover sats reales → resultado verificable**.
> Es el activo #1 para el voto comunitario y para que el jurado IA "vea" el producto.
>
> **Regla de oro (honestidad):** todo lo que se ve es **real y funciona en vivo**. Nada
> de pantallas trucadas, datos falsos, ni texto oculto dirigido al jurado. Si un tramo no
> está probado con sats reales, **no se filma como si funcionara** — se usa la Variante B.

---

## Por qué este formato gana

- **Una sola toma** = prueba de que es real (no un montaje de mockups). Es lo que separa
  a Luna Negra de un "deck bonito".
- **Sats reales moviéndose** = el momento "wow" que ningún competidor de "un solo juego"
  puede mostrar: Luna Negra es la **capa de identidad + pagos** para *cualquier* juego.
- **El juego es TETRA, un Tetris real hosteado aparte** (`tetra.naranja.fit`) que se enchufa
  vía la **API/SDK v1 pública** (SSO, salas, apuestas). Es un juego **independiente** —no un
  juguete incrustado en la tienda—, y se integra usando **exactamente la misma API/SDK que
  usaría cualquier tercero**. Frase honesta a decir: "construimos Tetra como juego real y lo
  enchufamos por la misma puerta pública que cualquier dev". (No digas "ya hay terceros
  integrados" si Tetra es tuyo: sería sobrevender y un jurado lo nota.)
- **Frase ancla (decir al empezar o en el título):**
  > "Esto no es un juego con Lightning. Es la capa que le da identidad Nostr y pagos en
  > sats a cualquier juego web — acá, un Tetris."

---

## Setup de filmación (preparar ANTES de grabar)

- **2 dispositivos a la vista**: la compu (jugador A / host) + el celular (jugador B y/o
  firmador NIP-46). El multijugador y el login por QR lucen mucho mejor con dos pantallas
  reales en cuadro.
- **Wallet con sats de verdad** (montos chicos: 50–500 sats). Tener saldo cargado y la
  conexión NWC ya enchufada en el navegador **antes** de grabar, para que el pago salga al
  toque y no haya esperas muertas.
- **El juego**: **TETRA** (Tetris real en `tetra.naranja.fit`), integrado vía API v1.
  Tenerlo publicado en la tienda y probado: login SSO, sala multijugador y apuesta.
  Para el tramo de "mover sats", decidir si TETRA va **de pago** (precio bajo en sats) o
  **gratis con zap al dev** (según la variante).
- **Ensayar 2–3 veces** sin grabar. La toma única perdona poco; el ritmo importa.
- Grabar a **1080p**, navegador en pantalla casi completa, cursor visible. Si el celu entra
  en cuadro, buena luz.
- **Cerrar notificaciones** del SO y pestañas de más.

---

## Guión tramo por tramo (toma única)

### 0:00–0:10 · Identidad Nostr (el "quién sos" sin email ni password)
1. Arrancás **deslogueado** en la home de la tienda (`luna.naranja.fit`).
2. Click en **Entrar** → elegís **NIP-46 (QR)**.
3. Agarrás el **celular**, escaneás el QR con el firmador (Amber/Primal), **aprobás**.
4. La navbar ya muestra tu **nombre y avatar reales** (kind:0 de Nostr).

> Mensaje: login sin cuenta tradicional, identidad portable de Nostr. (Si NIP-46 te da
> nervios en vivo, usá **NIP-07** con la extensión: es un click y también es real.)

### 0:10–0:35 · Mover sats (el corazón del loop) — elegí UNA variante

**Variante A — COMPRA (recomendada: está verificada con pago real):**
1. Entrás a la página de un juego de pago → **Comprar**.
2. Aparece el **invoice Lightning** (QR / LNURL / NWC). Pagás con la **wallet NWC** en un
   click (o escaneando con el celu).
3. El estado pasa a **pagado**; el juego entra a tu **biblioteca**. Mencionás el reparto
   **70/30** custodial (el proveedor cobra al instante).

**Variante B — ZAP AL DEV (si querés mostrar Nostr puro y un juego gratis):**
1. En un juego gratis, tarjeta **"Dejar un zap"** → elegís monto → **firmás el zap
   (NIP-57)** con tu wallet.
2. Se ve el **recibo** y el juego sube en el **top de zappers** (leaderboard real desde
   recibos 9735 verificados).

> Decir en voz alta: "esto son **sats de verdad** moviéndose ahora mismo, no un mock".

### 0:35–1:05 · Jugar TETRA + multijugador con un amigo (vía Nostr, sin pasar links)
1. Desde la biblioteca, **Jugar** → abre **TETRA** (`tetra.naranja.fit`) ya logueado por
   **SSO** (la sesión de Luna Negra entra al juego; el juego verifica el acceso por API v1).
2. Panel **"Jugar con amigos"** → creás sala (sos **👑 host**).
3. En el **celular** (jugador B, otra cuenta), abrís **/friends**: aparece tu presencia
   **"🎮 Jugando TETRA"** (NIP-38) con botón **"Unirse"** → entra **sin que le pases el
   link** (llega por Nostr).
4. Los dos juegan unos segundos un **Tetris** real, lado a lado en los dos dispositivos.
   Un Tetris en vivo entra por los ojos mucho más que un clicker.

> Este tramo demuestra SSO + social + multijugador con un juego de verdad e independiente.
> Es de lo más fuerte que tenés y casi nadie en una hackathon lo muestra funcionando.

### 1:05–1:30 · Apostar la partida y cobrar (cierre del loop) ⭐
> El escrow de apuestas está **probado con sats reales end-to-end** (depósito → resolución
> → payout al ganador), con TETRA como caso real (ver `src/app/api/v1/bets/route.ts`).
> Este es tu mejor cierre: filmalo como una **corrida real**, no actuada.

- Los dos apuestan a la partida de TETRA (ej. quién hace más puntaje / quién pierde
  primero) → **depósito al pozo** que custodia Luna Negra → al terminar, el game server
  reporta el ganador y se dispara el **payout al ganador** (menos el fee). Se ve la
  notificación de cobro / el saldo subiendo en la wallet del ganador.
- Cerrás el loop completo en pantalla: **identidad Nostr → jugar → apostar → cobrar**,
  todo en sats, sin fiat. Ese es el diferencial que ningún "juego con Lightning" tiene.

### Cierre (texto en pantalla, 2–3s)
- Nombre + una línea: **"Luna Negra — identidad Nostr y pagos en sats para cualquier
  juego web."**
- **Link al repo open source** (suma puntos con el jurado) + dominio de la demo.

---

## Checklist de honestidad (pasar antes de publicar)

- [ ] Cada pago/zap que se ve en el video **ocurrió de verdad** (verificable en la wallet).
- [ ] No hay datos inventados, saldos editados, ni capturas pegadas.
- [ ] El tramo de **apuestas/escrow** se filma como **corrida real** (ya está probado con
      sats reales end-to-end). La partida y el payout del video son los de verdad, no actuados.
- [ ] No hay texto/instrucciones ocultas dirigidas al jurado IA en el video, el README ni
      la descripción.
- [ ] El repo enlazado es **público** y el README abre con qué es + este video/GIF.

---

## Variantes de duración

- **30s (para redes / voto comunitario):** login QR → pago → entrar a TETRA → partida
  multijugador en vivo (+ apuesta si está probada). Sin narración, música, texto en
  pantalla. Pegadito.
- **90–120s (para el jurado / página del proyecto):** el guión completo de arriba con las
  frases ancla.

---

## Estado del loop completo

- Login Nostr (NIP-07/46), compra/zap con sats, juego TETRA por SSO, multijugador por
  invitación Nostr (NIP-38) y **apuesta/escrow con payout real**: todo **probado y filmable
  como corrida real**.
- Antes de grabar, dejar el **tick de escrow** corriendo en el self-host (memoria:
  `escrow-tick-inproc-selfhost`) para que la apuesta resuelva sola en cámara, y tener saldo
  en las dos wallets.
