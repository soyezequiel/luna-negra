# Decisiones de Arquitectura — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Base: [proposal.md](../proposal.md), [idea-validation.md](../idea-validation.md)

## Componentes

```
Game server (proveedor; en Fase 1 = Luna Negra)
   │  crea apuesta / reporta resultado firmado (Nostr)
   ▼
Vercel (Next.js)  ──────────────►  Neon Postgres  ◄────────── "Tick" (scheduler)
   - UI apuestas                   (fuente de verdad:           - revisa plazos vencidos
   - POST crear apuesta            apuestas, depósitos,         - dispara reembolsos
   - POST resultado (verifica firma)  payouts, estados)         - dispara payouts
   - genera invoices de depósito                                - lookup_invoice de depósitos
        │                                                            │
        └──────────────►  Alby Hub / NWC (wallet de escrow)  ◄───────┘
                          (un solo saldo; contabilidad por apuesta en DB)
                                   │
                                   ▼
                          Nostr (relays públicos): contrato inmutable + resultado firmado
```

## Decisiones confirmadas

| # | Decisión | Razón | Alternativa descartada |
|---|----------|-------|----------------------|
| A1 | El **"worker" = un endpoint `/api/escrow/tick` en Vercel** disparado por **Upstash QStash** (schedule recurrente) cada ~1 min | Evita levantar un servidor aparte; granularidad de minutos alcanza para plazos de 10/15 min; reusa Upstash (ya se usa para rate-limit). Cron nativo de Vercel en Hobby corre 1x/día | Mini-servidor always-on en Railway/Fly (más robusto; necesario solo si se quiere suscripción Nostr persistente) |
| A2 | **Dueño único del dinero:** solo el tick ejecuta `payInvoice` (payouts y reembolsos), **idempotente y con lock en DB** (transición atómica `pending→paid`), reusando el patrón de `maybePayout` ✏️ | Evita carreras que paguen y reembolsen la misma apuesta a la vez | Que Vercel y el tick muevan plata sin coordinación |
| A3 | **Estado en Neon = fuente de verdad.** Timers por **timestamps** (`depositDeadline`, `resolveDeadline`), no en memoria | Sobrevive reinicios; el tick recalcula qué venció leyendo la DB | Timers en memoria del proceso (se pierden al reiniciar) |
| A4 | **Wallet único Alby Hub** (compartido con la tienda) + **contabilidad por apuesta en DB** | Simplicidad en beta; Alby Hub es un solo saldo | Wallet separado por pozo (Alby Hub no lo da fácil) → ver R7 |
| A5 | **Destino de pago (R5) en cascada:** `lud16` del kind:0 → NWC del perfil → exigir LN address en el perfil Luna Negra (setea lud16) → **fallback: QR de retiro (LNURL-withdraw)** que el ganador escanea ✏️ | Cubre a todos los usuarios; el QR es la red de seguridad si no hay destino | Pedir invoice manual cada vez (mala UX) |
| A6 | **Depósitos:** N invoices, uno por jugador atado a su npub; el tick hace `lookup_invoice` de los pendientes hasta completar o vencer | Atribuye cada depósito a un jugador (saber quién pagó / a quién reembolsar) | LNURL/zap compartido sin atribución |
| A7 | **Resultado:** el server hace **POST del evento Nostr firmado** a `/api/escrow/result` (camino primario) + se publica en relays; Luna Negra **verifica la firma** contra el pubkey del proveedor del juego ✏️ | El POST es confiable e inmediato; Nostr da auditabilidad | Depender solo de escuchar relays (requiere proceso persistente) |
| A8 | **Contrato** publicado en **varios relays públicos** al crear, inmutable | Auditabilidad pública; es la defensa anti-proveedor-malicioso | Un solo relay (punto único de falla) |
| A9 | **`/api/escrow/tick` y `/api/escrow/result` protegidos** por secreto compartido (firma de QStash para el tick; bearer/secreto para endpoints internos) | Evita que cualquiera dispare reembolsos/payouts o falsifique resultados | Endpoint abierto (cualquiera lo invoca) — detalle fino en swr-security |
| A10 | **QR de retiro (LNURL-withdraw) entra en beta** como fallback de cobro cuando no hay lud16/NWC | El usuario lo pidió; garantiza que todo ganador pueda cobrar sí o sí | Dejarlo para post-beta (descartado) |

## Riesgos aceptados

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|-----------|
| R7 | Wallet compartido tienda+pozos: blast radius + posible **insolvencia** si un bug paga de más | Alto | Invariante en DB: nunca pagar/reembolsar más de lo depositado por esa apuesta; montos chicos (beta); wallet separado a escala |
| R8 | Disponibilidad/inmutabilidad del contrato en relays públicos | Medio | Publicar en varios relays; relay propio a futuro |

## Preguntas sin resolver

- _(resueltas)_ Scheduler = **Upstash QStash** · QR de retiro = **en beta (Must)** · `/tick` y `/result` = **protegidos** (A9).
- Pendiente para swr-security: esquema exacto de protección de `/tick` (firma QStash) y de `/result` (verificación de firma Nostr del proveedor).
