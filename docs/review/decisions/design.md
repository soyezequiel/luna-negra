# Decisiones de Diseño — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Base: [proposal.md](../proposal.md), [decisions/architecture.md](architecture.md)

## Superficies
- **Modal de Luna Negra embebido en el juego** — toda la interacción de la apuesta
  (leer contrato, depositar, ver estado, resultado, cobro). Lo sirve Luna Negra (no el juego).
- **Sección "Apuestas" en Luna Negra** — historial propio del jugador (apuestas, estados, resultados, reembolsos).

## Estados de UI (modal de apuesta)

| Estado | Qué ve el jugador | Sale hacia |
|--------|-------------------|-----------|
| Contrato | Contrato legible (juego, participantes c/npub, monto, condición de victoria, fee%, plazos, reglas de bordes, pubkey del proveedor que resuelve) + **link al posteo Nostr** + "Leer el contrato" | Disclaimer |
| Disclaimer | Aviso de apuestas/beta; aceptar para continuar | Depósito |
| Depósito | Invoice + **QR + copiar**; **countdown 10 min**; botón bloqueado tras el primer click | Esperando / Reembolso (timeout) |
| Esperando jugadores | "Pagaron X de N · faltan: @a, @b · 6:32" + lista de quién pagó / quién fue reembolsado | Lista / Reembolso |
| Lista / jugándose | "Todos depositaron — ¡a jugar!" (el juego arranca la partida) | Resuelta / Reembolso (timeout 15 min) |
| Resuelta — ganó | "Ganaste N sats" + "te pagamos a tu wallet" (si lud16/NWC) o botón **Retirar** (QR) | — / Retiro |
| Resuelta — empate | "Empate: te tocan N sats" (split) + mismo cobro | — / Retiro |
| Resuelta — perdió | "Perdiste esta vez" | — |
| Retiro (fallback) | **QR LNURL-withdraw on-demand** (solo cuando el user dice "estoy listo") + aviso: "tenés 60 min o los sats quedan en el pozo" | Cobrado / Forfeited |
| Reembolsado | "Te reembolsamos N sats" (incompleto / timeout / cancelado por admin) | — |
| Error de pago | "Hubo un problema con el pago, reintentando" (visible también para admin) | reintento |

## Flujos confirmados

| # | Flujo | Pasos | Caso de error |
|---|-------|-------|--------------|
| 1 | Apostar | Invitación (modal) → contrato → disclaimer → depósito → espera → lista → resultado → cobro | Cada timeout → reembolso; sin destino → QR; QR no reclamado en 60 min → **forfeited** |
| 2 | Reingreso | El resultado se publica en Nostr **tagueando a los jugadores** (lo ven en su cliente) + queda en el historial de Luna Negra | Si el jugador estaba offline, lo ve al volver |

## Contratos frontend-backend

| Acción | Envía | Recibe |
|--------|-------|--------|
| GET estado de apuesta | betId | juego, participantes [{npub, paid, refunded}], montoSats, condición, feePct, estado, depositDeadline, resolveDeadline, contractEventId+link, miEstado {paid, isWinner, payoutStatus, withdrawAvailable} |
| POST depositar | betId | invoice (bolt11+QR) — **idempotente** (mismo invoice si ya se generó) |
| POST retirar | betId | datos LNURL-withdraw / QR |
| GET mis apuestas | — | lista para el historial |

## Decisiones de UX

| # | Decisión | Razón |
|---|----------|-------|
| D1 | UI = modal de Luna Negra embebido en el juego + sección "Apuestas" (historial) | El jugador apuesta sin salir del juego, y tiene registro propio |
| D2 | Estado de depósitos en vivo (pagaron X/N + countdown), por polling | El jugador sabe si esperar, si arrancó o si le reembolsaron |
| D3 | Cobro automático a lud16/NWC ("te pagamos a tu wallet"); **QR de retiro on-demand** con **ventana de 60 min** y aviso de pérdida | Cubre a todos; evita pozos trabados por no-reclamo eterno |
| D4 | Resultado y reembolsos visibles en el modal **y** en el historial | Doble registro; transparencia |
| D5 | Contrato = posteo Nostr que **taggea a los participantes** + link al evento; el modal lo renderiza legible | Trust anchor verificable en el cliente Nostr propio del jugador |
| D6 ✏️ | Reingreso vía **resultado publicado en Nostr tagueando a los jugadores** + historial | Sin construir notificaciones propias (DM de Nostr = Could) |
| D7 ✏️ | Depósito **idempotente** (un invoice por jugador, botón bloqueado) + **todas las transiciones de dinero/estado atómicas** (dueño único = tick, por A2) | Doble click / dos tabs no duplican pago ni rompen el estado |

## Riesgos

| # | Riesgo | Impacto | Estado | Mitigación |
|---|--------|---------|--------|-----------|
| R9 | Retiro no reclamado en 60 min → sats **forfeited** (el jugador pierde lo ganado; quedan sats huérfanos en el wallet) | Medio | aceptado (beta) | Aviso muy claro + countdown visible; registrar `forfeited` en DB (cuadra con invariante R7) |
| R10 | El modal embebido en el juego es superficie de confianza: un **juego malicioso podría falsificar un modal** y phishear depósitos | Medio | sin resolver | El modal real lo sirve Luna Negra (iframe de su origen), no el juego; el jugador valida el contrato en su **propio cliente Nostr** (tag). Detalle en swr-security |
