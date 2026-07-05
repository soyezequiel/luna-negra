# Decisiones de Modelo de Datos — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Base: [proposal.md](../proposal.md), [architecture.md](architecture.md), [design.md](design.md)

## Entidades definidas

| Entidad | Campos clave | Identificador | Soft delete | Timestamps |
|---------|-------------|---------------|-------------|-----------|
| `Bet` | gameId, providerId, status, stakeMsat, feePct, victoryCondition, depositDeadline, resolveDeadline, contractEventId, resultEventId | cuid | no se borra (historial) | createdAt, readyAt?, settledAt? |
| `BetParticipant` | betId, userId, npub, depositStatus, depositInvoice, depositPaymentHash, result, payoutStatus, payoutMsat, payoutDestination, withdrawDeadline | cuid | no | createdAt, paidAt?, settledAt? |
| `LedgerEntry` (append-only) | betId, userId?, kind, amountMsat, status, paymentHash, idempotencyKey | cuid | nunca (inmutable) | createdAt |

**Dinero:** todo en **`BigInt` msat** (nunca float). Columnas con sufijo `Msat` para evitar confusión con la tienda (que usa sats `Int`).

**Máquina de estados de `Bet`** (string, transiciones validadas en código dentro de transacción):
```
created → pending_deposits → ready → settling → settled
                 │                       └─(timeout 15m)→ refunding → refunded_timeout
                 ├─(timeout 10m, incompleto)→ refunding → cancelled_incomplete
                 └─(admin cancela)──────────→ refunding → cancelled_admin
```
`settling` y `refunding` son estados **transitorios de procesamiento** (claimados por un solo tick — ver concurrencia).

**Estados de `BetParticipant`:**
- `depositStatus`: pending | paid | refunded | failed
- `result`: pending | won | lost | tie
- `payoutStatus`: none | pending | paid | failed | withdraw_pending | claimed | forfeited

**`LedgerEntry.kind`**: deposit (in) · payout · refund · fee · forfeit. `amountMsat` positivo; el `kind` indica dirección.

## Relaciones

| Entidad A | Relación | Entidad B | Cascade | Tabla intermedia |
|-----------|----------|-----------|---------|-----------------|
| Game | 1:N | Bet | RESTRICT (no borrar Game con apuestas) | — |
| Provider | 1:N | Bet | RESTRICT (Provider resuelve/firma) | — |
| User | N:M | Bet | — | **BetParticipant** (con estado por jugador) |
| Bet | 1:N | LedgerEntry | RESTRICT (ledger inmutable) | — |
| User | 1:N | LedgerEntry | SET NULL (fee/forfeit = house, sin user) | — |

## Campos monetarios

| Tabla.campo | Tipo | Unidad |
|-------------|------|--------|
| Bet.stakeMsat | BigInt | msat |
| BetParticipant.payoutMsat | BigInt | msat |
| LedgerEntry.amountMsat | BigInt | msat |

## Integridad y concurrencia (decisión mía)

| Mecanismo | Cómo |
|-----------|------|
| **Sin doble-gasto (DB-level)** | Cada movimiento saliente (payout/refund) inserta un `LedgerEntry` con **`idempotencyKey` ÚNICO** (`{kind}:{betId}:{userId}`) **antes** de llamar `payInvoice`. Un segundo intento choca con el UNIQUE y se descarta. |
| **Claim del procesamiento** | El tick reclama la apuesta con update optimista: `UPDATE Bet SET status='settling' WHERE id=? AND status='ready'`; solo el que afecta 1 fila procesa. Igual para `refunding`. |
| **Invariante anti-insolvencia (R7)** | Antes de pagar: dentro de la transacción, `Σ deposits(settled) ≥ Σ (payouts+refunds+fees) ya registrados + este movimiento` por apuesta. Si no cuadra, aborta. |
| **Idempotencia de depósito** | `BetParticipant.depositPaymentHash` UNIQUE; `lookup_invoice` confirma una sola vez. |
| **Reembolso/payout reusan patrón `maybePayout`** | Estados pending→paid/failed + reintento. |

Restricciones únicas: `@@unique([betId, userId])` en BetParticipant · `@@unique([idempotencyKey])` y `depositPaymentHash` único en su tabla.

## Datos de crecimiento ilimitado

| Tabla | Crecimiento | Estrategia |
|-------|------------|-----------|
| Bet / BetParticipant / LedgerEntry | Lento (N por apuesta) | Sin archivado por ahora; índices por betId, status, deadlines |
| Eventos NGP | NO se guardan completos | Solo se guarda el **event id** (contractEventId, resultEventId) |

## Decisiones de desnormalización

| Qué | Por qué | Cómo se sincroniza |
|-----|---------|-------------------|
| `BetParticipant.npub` | Para el contrato/display sin join a User | Se copia al crear; el npub no cambia |
| Resultado (won/lost/tie) en participante | Evita recalcular desde el evento NGP | Lo escribe el procesamiento del resultado verificado |

## Migraciones previstas

| Cambio | Complejidad | Downtime | Estrategia |
|--------|------------|----------|-----------|
| Agregar tablas Bet/BetParticipant/LedgerEntry | Baja | No | `prisma migrate` (tablas nuevas, no tocan las existentes) |
| Índices en deadlines/status | Baja | No | En la misma migración |

## Riesgo nuevo

| # | Riesgo | Impacto | Estado | Mitigación |
|---|--------|---------|--------|-----------|
| R11 | Unidad de dinero inconsistente: tienda en **sats (Int)**, apuestas en **msat (BigInt)** → bug de conversión | Medio | sin resolver | Sufijo `Msat` explícito en columnas + helpers de conversión sats↔msat + tests de conversión |
