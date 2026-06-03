# Plan de implementación — Apuestas / Escrow (Fase 1)

Derivado de `docs/review/` (revisión swr-review completa).

> **Estado: M0–M7 implementados (código) ✅** — tsc limpio + 37 tests. Falta lo
> que depende del usuario: aplicar la migración, conectar QStash + Alby Hub,
> integrar el demo (crear apuesta + reportar resultado firmado) y la **prueba real**.
Alcance: **Luna Negra como único proveedor, beta entre conocidos** (caso testigo: Tetris).
Esfuerzo: **S** (horas) · **M** (1-2 días) · **L** (varios días). Dev solo.

> Orden por dependencias. Cada hito tiene su "Definition of Done" (DoD).
> Gates que NO se cruzan en Fase 1: proveedores 3ros (oráculo), legal/gambling, escala.

---

## M0 · Fundaciones de datos + dinero  (M)
La base sobre la que se apoya todo. **Acá viven los tests del dinero.**
- Prisma: modelos **`Bet`**, **`BetParticipant`**, **`LedgerEntry`** (ver `decisions/data-model.md` + `diagrams/er-core-models.mmd`). Montos en **`BigInt` msat**; `@@unique([betId,userId])`, `idempotencyKey` único, `depositPaymentHash` único; índices por `status` y deadlines. Migración Prisma.
- Helpers **sats↔msat** (R11) + columnas con sufijo `Msat`.
- **`lib/ledger.ts`**: registrar movimientos (deposit/payout/refund/fee/forfeit) con `idempotencyKey`, dentro de transacción, aplicando el **invariante anti-insolvencia** (Σdepósitos ≥ Σsalidas por apuesta).
- **Tests (Vitest)**: ledger idempotente, invariante (rechaza pagar de más), conversión de unidades, transiciones de estado válidas/ inválidas.
- **DoD:** los tests del dinero pasan; no se puede registrar un payout que viole el invariante.

## M1 · Crear apuesta + contrato Nostr  (M)
- Auth **NIP-98** del game server: `verifyEvent` + firmante **== Provider dueño del `gameId`** (S1/T1).
- `POST /api/escrow/bets`: valida `stakeMsat ∈ [min,max]`, **fee fijado por Luna Negra** (ignora el del request), npubs válidos → crea `Bet` (`pending_deposits`) + `BetParticipant[]` + `depositDeadline = now+10min`.
- **Publicar contrato inmutable en Nostr** (varios relays): evento con tags `p` a los participantes + content legible (juego, monto, condición, fee%, plazos, reglas de bordes, pubkey del proveedor). Guardar `contractEventId`.
- Config: `BET_MIN_MSAT`, `BET_MAX_MSAT`, `BET_FEE_PCT`, relays.
- **DoD:** un request firmado válido crea la apuesta y publica el contrato; uno con pubkey ajeno → 403 `NOT_GAME_OWNER`.

## M2 · Depósitos  (M)
- **Bet-session token**: emitir al lanzar el juego (extiende el play-token) — JWT `{sub,npub,pubkey,purpose:"bet-session",exp corto}`. Se pasa al modal por `postMessage`.
- `POST /api/escrow/bets/[id]/deposit` (cookie o Bearer): solo participante; **idempotente** (mismo invoice si ya existe); `makeInvoice` msat; guarda `depositPaymentHash`. Errores: `NOT_PARTICIPANT`/`ALREADY_PAID`/`DEPOSIT_CLOSED`/`BET_NOT_FOUND`.
- **DoD:** un participante obtiene su invoice; doble click no genera doble cobro; un no-participante recibe 403.

## M3 · UI: modal embebido + sección "Apuestas"  (L)
- `GET /api/escrow/bets/[id]` (polling ~3s) y `GET /api/escrow/bets/mine` (historial).
- **Modal** servido por Luna Negra (iframe), autenticado por **Bearer** (no cookie): leer contrato + link al posteo Nostr → disclaimer → depósito (QR + copiar + countdown 10min) → espera (pagaron X/N + countdown) → resultado/cobro. `postMessage` con el juego.
- Sección **"Apuestas"** (historial first-party, cookie).
- Disclaimer de apuestas (no se deposita sin aceptarlo).
- **DoD:** flujo completo navegable contra datos reales de M1/M2; estados de UI de `decisions/design.md` cubiertos.

## M4 · El tick (QStash) + reembolsos/payouts  (L)  ← corazón del escrow
- `POST /api/escrow/tick` protegido por **firma QStash** (rechaza inválidas).
- Lógica idempotente con **claim optimista** (`UPDATE ... WHERE status=...`):
  - `lookup_invoice` de depósitos pendientes → `ready` cuando completan (+ `resolveDeadline = now+15min`).
  - depósito **timeout 10min** incompleto → reembolso a los que pagaron → `cancelled_incomplete`.
  - resolución **timeout 15min** → reembolso total → `refunded_timeout`.
  - procesar payouts/reembolsos `pending`/`failed` (reusa patrón `maybePayout`, vía ledger).
- Configurar **QStash schedule** → `/tick` cada ~1 min.
- **DoD:** con QStash apagado, al reactivarlo procesa lo pendiente; los timeouts reembolsan solos; ningún doble pago.

## M5 · Resultado firmado + reparto  (M)
- `POST /api/escrow/result`: `verifyEvent` + signer==provider del game + `betId` + **frescura**; **inmutable** (409 `ALREADY_RESOLVED`, 410 `TOO_LATE` si ya se reembolsó); marca ganador(es)/empate.
- Disparar payout: **cascada de destino** lud16 (kind:0) → NWC → exigir LN address en perfil. Empate → split (−fee). Publicar resultado en Nostr (tag a jugadores) para reingreso.
- **DoD:** resultado válido paga al ganador (pozo−5%); empate divide; resultado tardío no paga (410); firma ajena → 403.

## M6 · Retiro (LNURL-withdraw) + forfeit  (M)
- Endpoints LNURL-withdraw (`/api/escrow/lnurlw/[token]` + `/callback`), token de un solo uso, ventana **60min**.
- El tick marca `forfeited` tras 60min sin reclamar (R9).
- **DoD:** un ganador sin lud16/NWC cobra escaneando el QR; pasados 60min sin reclamar, queda `forfeited` y cuadra el ledger.

## M7 · Admin + hardening + pruebas reales  (M)
- Cancelación admin de apuestas incompletas; panel admin: ver apuestas + payouts/reembolsos fallidos + **reintentar** (reusa lo de A3).
- **Rate-limit** Upstash en crear/depositar.
- Integrar el **demo (Tetris)**: su "server" crea la apuesta (firmado) y reporta el resultado.
- **Pruebas end-to-end reales** con montos chicos (5-100 sats): feliz, depósito incompleto, timeout, empate, sin-destino→QR, doble-tick. Verificar contabilidad/invariante.
- **DoD:** una apuesta real entre 2-3 amigos en Tetris se juega y paga de punta a punta.

---

## Infra nueva a activar (tuyo)
- **Upstash QStash**: schedule → `POST /api/escrow/tick` (header de firma).
- **NWC budget cap** en Alby Hub (acota blast radius).
- Env nuevas: `BET_MIN_MSAT`, `BET_MAX_MSAT`, `BET_FEE_PCT`, `QSTASH_*` (signing keys).

## Riesgos vivos a vigilar (de `risks/registry.md`)
- R7 invariante anti-insolvencia (M0) · R5/cascada de cobro (M5/M6) · R10/R1 gate de 3ros · R2 legal antes de escalar.
