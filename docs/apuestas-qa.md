# Checklist de QA — Prueba real de apuestas (Fase 1)

Objetivo: validar el loop completo con **plata real (montos chicos: 5–10 sats)** entre
**2 cuentas** (las llamamos **A** y **B**), antes de abrirlo a más gente.

> ⚠️ Antes de empezar: poné un **budget/límite de gasto bajo** al NWC en Alby Hub
> (ej. 1.000 sats). Es tu red de seguridad si algo sale mal.

---

## 0. Prerequisitos
- [ ] **2 cuentas Nostr** (A y B), cada una con **extensión** (nos2x/Alby) y un **wallet Lightning con saldo** (para depositar) y, ideal, una **Lightning Address en el perfil (lud16)** para cobrar automático.
- [ ] Ambas cuentas **logueadas alguna vez en Luna Negra** (para existir como usuarios) y con **acceso al juego** de prueba.
- [ ] El wallet de Luna Negra (NWC) con **saldo** y **budget cap** puesto.
- [ ] Forma de **crear la apuesta y reportar el resultado** (firmados NIP-98 / evento) — vía el game server del demo o un script. *(Si no lo tenés, pedí el script de integración.)*

## 1. Pre-vuelo (5 min)
- [ ] `POST /api/escrow/tick` da **200** en los logs (QStash andando).
- [ ] Entrás a `/bets` con A y con B → carga sin error (historial vacío al principio).
- [ ] En Alby Hub anotá el **saldo inicial** del wallet (para comparar al final).

## 2. Camino feliz (1v1, winner-takes-all)
1. [ ] **Crear apuesta** A vs B, 10 sats, condición "mayor puntaje". → devuelve `betId` + `contractEventId`.
2. [ ] **Contrato en Nostr**: abrí `njump.me/<contractEventId>` → se ve legible, con los **2 npubs**, monto, fee, plazos. (A y B deberían verlo tagueados en su cliente Nostr.)
3. [ ] **A entra a `/bets/<id>`** → ve el contrato → acepta disclaimer → **Depositar** → paga el invoice con su wallet.
4. [ ] **B** hace lo mismo.
5. [ ] En < (intervalo del tick) la apuesta pasa a **`ready`** ("¡Todos depositaron!"). Verificá que **ambos** ven ese estado.
6. [ ] **Reportar resultado**: ganador = A. → la apuesta pasa a **`settled`**.
7. [ ] **A** ve "🎉 ¡Ganaste!" y **cobra**: si tiene lud16 → "Cobrado ✓" y le **llega ~19 sats** (20 − 5%). **B** ve "Perdiste".
8. [ ] **Contabilidad**: el wallet de Luna Negra quedó con **+1 sat** (el fee del 5% de 20 = 1 sat) respecto al saldo inicial.

## 3. Bordes (uno por uno, apuesta nueva cada vez)
- [ ] **Depósito incompleto**: A deposita, B **no**. Esperá los **10 min**. → A recibe el **reembolso**; estado `cancelled_incomplete`; A ve "te devolvimos".
- [ ] **Timeout de resolución**: A y B depositan (queda `ready`), pero **no reportás resultado**. Esperá los **15 min**. → **reembolso total** a ambos; estado `refunded_timeout`.
- [ ] **Empate**: reportá **2 ganadores** (A y B). → el pozo (−fee) se **divide**; ambos ven "Empate" y cobran la mitad.
- [ ] **Cobro por QR (sin lud16)**: usá una cuenta **sin lud16** en el perfil. Al ganar → aparece **"Retirar (mostrar QR)"** → escaneás con el wallet → te llega.
- [ ] **Forfeit**: ganá con una cuenta sin lud16 y **NO** reclames el QR por **60 min**. → estado `forfeited`; los sats quedan en el pozo (la casa).
- [ ] **Cancelación admin**: creá una apuesta, depositá con 1, y desde `/admin → Apuestas` tocá **Cancelar** → reembolso al que pagó; estado `cancelled_admin`.

## 4. Verificación de contabilidad (clave, hay plata)
Por cada apuesta resuelta, revisá en `prisma studio` la tabla `LedgerEntry`:
- [ ] Suma de `deposit` (settled) = suma de `payout` + `refund` + `fee` (settled) → **el pozo cuadra**.
- [ ] No hay `payout`/`refund` duplicados (un `idempotencyKey` por movimiento).
- [ ] Ningún movimiento dejó el pozo en **negativo** (invariante anti-insolvencia).
- [ ] El **saldo real** del wallet Alby Hub ≈ saldo inicial + suma de fees (menos fees de routing de Lightning).

## 5. Si algo falla — dónde mirar
- **Estado trabado** (no pasa a ready / no reembolsa): revisá que el **tick de QStash** siga dando 200; mirá `Bet.status` en la DB.
- **Payout/reembolso `failed`**: `/admin → Payouts a resolver` → **Reintentar**. Causa típica: lud16 inválida o sin saldo/budget.
- **Depósito no detectado**: el tick hace `lookup_invoice`; verificá que el invoice se pagó de verdad y que el NWC ve el pago.
- **Logs**: Vercel → Logs (errores de `/api/escrow/*`).

---

## Criterio de aprobación
- [ ] Camino feliz: ganador cobró, perdedor no, fee quedó en la casa, contabilidad cuadra.
- [ ] Al menos **reembolso por incompleto** y **timeout** funcionaron y devolvieron la plata.
- [ ] Ningún caso dejó **fondos trabados** ni el pozo en negativo.

Si todo esto pasa → la beta de apuestas está lista para **un grupo chico de conocidos** (recordá los gates antes de abrir a desconocidos: oráculo de 3ros + legal).
