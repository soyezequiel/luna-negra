# Revisión de Software — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Skills ejecutados: swr-idea, swr-requirements, swr-architecture, swr-design, swr-data, swr-api, swr-security
No ejecutados (a pedido): swr-performance, swr-cost, swr-dx, swr-testing, swr-visualizer

---

## El sistema en una oración
Apuestas de N jugadores en juegos web, con pozo en **escrow custodiado por Luna Negra** (Alby Hub/NWC), un **contrato inmutable en Nostr** legible antes de pagar, resolución por el **game server firmada con Nostr**, y reparto al ganador menos **5%** de fee — acotado a **Fase 1: Luna Negra como único proveedor, beta entre conocidos**.

## Validación de idea
| Recomendación | Tipo | Pivots |
|---------------|------|--------|
| **CONSTRUIR (acotado a Fase 1)** | Negocio | Ninguno (se descartaron torneos / no-custodial / juego-custodia: el usuario quiere fee + escrow) |

Señal de demanda real a micro-escala (amigos, Tetris). El **contrato en Nostr** es el diferenciador y una mitigación (capa el robo al fee). Trust del oráculo neutralizado mientras el único proveedor sea Luna Negra.

## Decisiones clave por dominio

### Arquitectura
- "Worker" = **QStash → `/api/escrow/tick`** cada ~1 min (sin servidor aparte).
- **Dueño único del dinero**: solo el tick paga/reembolsa, idempotente + lock en DB.
- Estado y timers en **Neon** (timestamps), sobrevive reinicios.

### Diseño
- UI = **modal de Luna Negra embebido en el juego** + sección "Apuestas".
- Cobro automático a wallet; **QR de retiro (LNURL-withdraw)** con ventana de 60 min.
- **Contrato en Nostr (tag a los jugadores) = trust anchor** verificable en el cliente propio.

### Modelo de datos
- `Bet` / `BetParticipant` / `LedgerEntry` (append-only).
- Todo en **msat (`BigInt`)**, nunca float.
- Anti-doble-gasto: `idempotencyKey` único + claim optimista + **invariante anti-insolvencia**.

### Contratos de API
- **Modal autentica con Bearer token** (no cookie 3rd-party); el juego se lo pasa por postMessage.
- Server crea/resuelve con **NIP-98** (firma Nostr); tick con **firma QStash**.
- Resultado **inmutable** (1er válido gana; tardío → 410); polling (sin WebSocket).

### Seguridad (STRIDE)
- Resultado: firma válida + signer == dueño del game + betId + frescura.
- **Bearer de mínimo privilegio** (no redirige fondos); destino de cobro sale del perfil/wallet.
- **Fee fijado por Luna Negra**; **NWC con budget cap**; rate-limit; ledger anti-doble-cobro.

### Performance / Cost / DX / Testing
- No ejecutados. A escala beta (5-100 sats, montos chicos, pocos usuarios) el riesgo es bajo.
- **Testing es el que más conviene hacer antes de codear**: el ledger, el invariante anti-insolvencia y los bordes de dinero (timeout, empate, reembolso, doble-tick) deben tener tests.

## Riesgos sin resolver (2)
| # | Origen | Riesgo | Impacto |
|---|--------|--------|---------|
| R4 | idea | Demanda amplia no validada (solo el círculo del fundador) | Medio |
| R11 | data | Unidad de dinero inconsistente (tienda sats / apuestas msat) | Medio |

## Riesgos aceptados (beta) — gateados antes de escalar
| # | Riesgo | Mitigación / Gate |
|---|--------|-------------------|
| R1 | Oráculo con proveedores terceros | Fase 1 self-provider; **gate antes de 3ros** |
| R2 | Legal / gambling (Argentina + escala) | Diferido; **consulta legal antes de abrir a desconocidos** |
| R3 | Custodia del pozo (contraparte/seguridad) | Disclaimer beta; montos chicos; **gate a escala** |
| R7 | Wallet compartido tienda+pozos / insolvencia | Invariante DB; montos chicos; wallet separado a escala |
| R8 | Disponibilidad del contrato en relays públicos | Varios relays; relay propio a futuro |
| R9 | Retiro no reclamado en 60 min → forfeited | Aviso claro + countdown; registrar en DB |
| R10 | Modal falso de juego malicioso | No aplica con único proveedor; gate antes de 3ros |
| R12 | LNURL-withdraw (superficie extra) | Solo fallback; degradable a "pegá tu LN address" |

Mitigados: R5 (destino de pago), R6 (worker/timers), R13 (bet-session token).

## Preguntas sin resolver (para antes de ESCALAR, no de la beta)
- **Legal**: consulta jurídica antes de abrir a desconocidos (R2).
- **Oráculo de terceros**: mecanismo de confianza/disputa antes de aceptar proveedores externos (R1/R10).
- **Validar demanda** con usuarios reales más allá de los amigos (R4).
- **Estrategia de testing** del dinero (swr-testing no ejecutado).

## Artefactos generados
Ver [README.md](README.md) — idea-validation, proposal, decisions/{architecture,design,data-model,api-contracts,security}, diagrams/{er-core-models, sequence-bet-deposit, sequence-bet-resolve}, risks/registry.

## Próximo paso
**Listo para crear el plan de implementación de la Fase 1.** No hay riesgos sin resolver de impacto alto: los altos (oráculo 3ros, legal, custodia a escala) están **aceptados y gateados a la fase de escala**, no bloquean la beta entre conocidos. Recomendado antes de codear: definir los **tests del dinero** (ledger, invariante, bordes).
