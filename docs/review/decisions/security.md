# Decisiones de Seguridad — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Base: architecture.md, design.md, data-model.md, api-contracts.md
Foco: **custodia de fondos de terceros** → prioridad = plata.

## Modelo de amenazas STRIDE

| # | Categoría | Amenaza | Componente | Mitigación | Estado |
|---|-----------|---------|-----------|-----------|--------|
| S1 | Spoofing | Forjar la firma del proveedor en `/result` para declarar ganador falso | /escrow/result | `verifyEvent` + firmante == **Provider dueño del game** + evento atado al `betId` + **frescura** (created_at reciente). Forjar la firma de un tercero es criptográficamente inviable | mitigado |
| S2 | Spoofing | Robo/replay del **Bearer bet-session** (el game host lo puede leer) | modal / API | **Mínimo privilegio**: solo read + generar invoice de depósito; **NO** puede setear destino de cobro; `exp` corta; `purpose:"bet-session"` | mitigado |
| S3 | Spoofing | **Modal falso** de un juego malicioso (phishing del depósito) | modal embebido | **Fase 1: el único proveedor es Luna Negra** → no hay game ajeno. Contrato en Nostr = auditoría. Confirmación first-party del pago = **gate antes de abrir a 3ros** | aceptado (beta) |
| T1 | Tampering | `feePct`/`stakeMsat` manipulados en crear-apuesta | /escrow/bets | **El fee lo fija Luna Negra** (ignora el del request); validación server-side de `stakeMsat ∈ [min,max]` y npubs válidos | mitigado |
| T2 | Tampering | Cliente manda montos/IDs que el backend confía | todos | El backend **nunca** confía montos del cliente; todo deriva de la apuesta en DB | mitigado |
| R1 | Repudiation | El proveedor declara ganador y lo niega | /result | Evento **firmado** guardado (`resultEventId`) + publicado en Nostr = prueba inmutable y atribuible | mitigado |
| I1 | Info disclosure | Filtración del **NWC** (mueve toda la plata) | env / tick | Env **server-only**, nunca al cliente ni a logs; **budget/límite de gasto** en Alby Hub para acotar el daño | mitigado |
| I2 | Info disclosure | Stack traces / datos de pozos en errores | API | Formato `{error,code}` sin internos; no loguear secretos ni invoices completos | mitigado |
| D1 | DoS | Spam de crear-apuesta / depositar | endpoints | **Rate-limit Upstash** por proveedor/IP (crear) y por usuario/IP (depositar) | mitigado |
| D2 | DoS | `/tick` falso disparando reembolsos/payouts | /escrow/tick | **Verificar firma de QStash**; rechazar requests sin firma válida | mitigado |
| E1 | Elevation | Jugador cobra sin ganar, o se reembolsa **y** cobra | tick / payout | Resultado solo del proveedor firmado; **`idempotencyKey` único por movimiento** en el ledger; **invariante anti-insolvencia**; transiciones atómicas con claim optimista | mitigado |
| E2 | Elevation (IDOR) | Operar/ver una apuesta ajena | GET / deposit | Autorización por identidad de sesión/token: solo el **participante** (userId) opera su parte; el endpoint expone el contrato público + solo el `me` propio | mitigado |

## Autenticación

| Aspecto | Decisión |
|---------|----------|
| Métodos | Jugador: cookie JWT (first-party) **o** Bearer bet-session (modal). Server/proveedor: **NIP-98** (firma Nostr). Tick: **firma QStash**. Admin: cookie + `isAdmin` |
| Almacenamiento del token | Cookie httpOnly (sesión); bet-session **en memoria del modal** (vía postMessage), no en localStorage |
| Expiración | bet-session corta (~1-2 h); cookie 30 d (existente) |
| Invalidación | bet-session no se revoca individual (la exp corta lo acota) |
| MFA | No aplica — la firma Nostr es el factor |

## Autorización

| Recurso/Acción | Quién | Dónde se valida | IDOR |
|----------------|-------|-----------------|------|
| Crear apuesta | Provider dueño del game | backend (firma + ownership) | ✅ |
| Depositar | participante de la apuesta | backend (userId ∈ participants) | ✅ |
| Ver apuesta | participantes (full) / contrato público en Nostr | backend | ✅ |
| Reportar resultado | Provider del game | backend (firma) | ✅ |
| Retirar | el ganador, **a su propio destino** | backend | ✅ |
| Cancelar | admin | backend (`isAdmin`) | ✅ |
| Tick | QStash | backend (firma) | ✅ |

## Datos sensibles

| Dato | Clasificación | At-rest | Tránsito | En logs | En URLs |
|------|--------------|---------|----------|---------|---------|
| `NWC_CONNECTION_STRING` | crítico (mueve fondos) | env server-only | TLS | **nunca** | nunca |
| `JWT_SECRET` | crítico | env server-only | — | nunca | nunca |
| bet-session token | sensible (mínimo privilegio) | memoria | TLS | nunca | (vía postMessage, no en URL persistente) |
| Destino de cobro (lud16) | semi-público (ya público en Nostr) | DB | TLS | ok | no |
| Passwords | — | no hay (identidad Nostr) | — | — | — |

## Validación de inputs

| Input | Fuente | Validación backend |
|-------|--------|-------------------|
| `stakeMsat` | crear apuesta | entero, ∈ [min,max] configurable |
| `participants` | crear apuesta | npubs válidos; tamaño N razonable |
| `feePct` | crear apuesta | **ignorado** (lo fija Luna Negra) |
| evento de resultado | /result | `verifyEvent` + signer==provider + betId + frescura |
| montos de payout/reembolso | — | derivados de la DB, nunca del cliente |

## Riesgo nuevo

| # | Riesgo | Impacto | Estado | Mitigación |
|---|--------|---------|--------|-----------|
| R13 | El bet-session token es legible por el game host (se lo pasás por postMessage) | Medio | mitigado | Mínimo privilegio (no redirige fondos) + exp corta; el destino de cobro sale del perfil/wallet del jugador, no del token |
