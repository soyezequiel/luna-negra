# Contratos de API — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Base: architecture.md, design.md, data-model.md

## Convenciones generales

| Aspecto | Decisión |
|---------|----------|
| Tipo de API | REST (Next.js route handlers), igual que el resto |
| Naming | camelCase |
| Fechas | ISO 8601 |
| IDs | cuid |
| Dinero | enteros **msat** |
| Auth jugador | **cookie de sesión** (páginas first-party de Luna Negra) **o** **Bearer token** (modal embebido) |
| Auth server (proveedor) | **NIP-98**: evento Nostr firmado en `Authorization: Nostr <base64>` |
| Auth tick | Firma de **QStash** (header) |
| Auth admin | cookie de sesión + `isAdmin` |
| Tiempo real | **Polling** ~3 s (sin WebSocket — serverless) |

## Decisión central: sesión del modal embebido (resuelve R10 y el problema de cookies)

- El **modal lo sirve Luna Negra** (iframe de su origen) → confianza de origen.
- Como un iframe cross-origin **no recibe la cookie** (3rd-party, bloqueada por Safari/Brave/Chrome), el modal usa un **Bearer token**:
  1. El jugador (logueado en Luna Negra, **cookie first-party**) lanza el juego.
  2. Luna Negra emite un **bet-session token** (JWT `{ sub, npub, pubkey, purpose:"bet-session", exp corto }`) que viaja al juego junto al play-token.
  3. El juego se lo pasa al iframe del modal por **`postMessage`**.
  4. El modal llama a la API con `Authorization: Bearer <token>`.
- **game ↔ modal**: `postMessage` (game: "abrí la apuesta X"; modal: "depósitos completos, podés arrancar").
- La cookie solo se usa first-party (lanzamiento + sección "Apuestas"); el iframe nunca depende de ella.

## Formato de errores

```json
{ "error": "mensaje legible", "code": "MACHINE_CODE" }
```
(Extiende el formato actual `{ error }` agregando `code` para que el modal reaccione.)

## Endpoints

| Método | Ruta | Descripción | Auth | Idempotente |
|--------|------|-------------|------|-------------|
| POST | `/api/escrow/bets` | El game server crea una apuesta | Nostr (proveedor dueño del game) | No |
| GET | `/api/escrow/bets/{id}` | Estado de la apuesta (para modal, polling) | Cookie o Bearer | (read) |
| POST | `/api/escrow/bets/{id}/deposit` | Devuelve invoice de depósito | Cookie o Bearer (participante) | **Sí** (mismo invoice) |
| GET | `/api/escrow/bets/mine` | Historial del jugador (sección Apuestas) | Cookie | (read) |
| POST | `/api/escrow/result` | El server reporta el resultado firmado | Nostr (proveedor) | **Sí** (1er válido) |
| GET | `/api/escrow/lnurlw/{token}` (+ `/callback`) | Retiro **LNURL-withdraw** (QR) | token de un solo uso | Sí |
| POST | `/api/escrow/tick` | Procesa plazos (depósito 10m, resolución 15m, payouts/reembolsos) | Firma QStash | **Sí** (claim optimista + idempotencyKey) |
| POST | `/api/escrow/bets/{id}/cancel` | Cancela apuesta incompleta | Cookie + admin | Sí |

### Ejemplos

**Crear**
```
POST /api/escrow/bets   Authorization: Nostr <evento firmado por el proveedor>
{ "gameId":"g1","participants":["npub1a","npub1b"],"stakeMsat":5000,"feePct":5,"victoryCondition":"mayor puntaje en 3 min" }
→ 201 { betId, contractEventId, depositDeadline }
   403 { code:"NOT_GAME_OWNER" }   400 { code:"STAKE_OUT_OF_RANGE" }
```

**Depositar** (idempotente)
```
POST /api/escrow/bets/b1/deposit   Authorization: Bearer <bet-session>
→ 200 { invoice, paymentHash, expiresAt }
   403 NOT_PARTICIPANT | 409 ALREADY_PAID | 410 DEPOSIT_CLOSED | 404 BET_NOT_FOUND
```

**Estado** (polling ~3s)
```
GET /api/escrow/bets/b1
→ 200 { status, participants:[{npub,paid,refunded}], stakeMsat, feePct, victoryCondition,
        depositDeadline, resolveDeadline, contractEventId, me:{paid,result,payoutStatus,withdrawUrl?} }
```

**Resultado** (inmutable)
```
POST /api/escrow/result   { event:{ kind, pubkey, sig, tags:[["bet","b1"],["winner","npub1a"]] } }
→ 200 { ok:true } | 403 WRONG_SIGNER | 409 ALREADY_RESOLVED | 410 TOO_LATE (ya reembolsada; se registra reporte tardío del proveedor)
```

## APIs / servicios consumidos

| Servicio | Uso | Timeout | Fallback |
|----------|-----|---------|----------|
| Alby Hub / NWC | makeInvoice (depósito), payInvoice (payout/reembolso), lookupInvoice (tick) | corto | reintento idempotente (tick) |
| Upstash QStash | dispara `/api/escrow/tick` cada ~1 min | — | si no dispara, el próximo tick recupera pendientes (estado en DB) |
| Relays Nostr | publicar contrato + resultado; leer firma del proveedor | corto | publicar en varios relays |
| Wallet del jugador (LNURL-withdraw) | cobro por QR cuando no hay lud16/NWC | 60 min ventana | si no reclama → forfeited |

## Eventos en tiempo real
Ninguno (no WebSocket). El modal hace **polling** de `GET /api/escrow/bets/{id}`. El resultado se publica además en Nostr (tag a los jugadores) para reingreso.

## Riesgo nuevo

| # | Riesgo | Impacto | Estado | Mitigación |
|---|--------|---------|--------|-----------|
| R12 | LNURL-withdraw = superficie extra (endpoints de callback, token de un solo uso, ventana) | Medio | aceptado (beta) | Solo es fallback (mayoría cobra por lud16/NWC); acotar a montos chicos; si pesa, degradar a "pegá tu LN address" |
