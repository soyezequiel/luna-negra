# Propuesta — Luna Negra: Apuestas / Escrow (Fase 1)

Fecha: 2026-06-03
Base: [idea-validation.md](idea-validation.md) — veredicto CONSTRUIR acotado a Fase 1
(Luna Negra como único proveedor, beta entre conocidos).

## Resumen
Apuestas de **N jugadores** en juegos web, con **mismo monto** por jugador y
**winner-takes-all** (empate → split). **El game server crea** la apuesta y
**reporta el ganador firmando con Nostr** (para que el resultado quede registrado y
un proveedor malicioso sea identificable). Luna Negra **custodia el pozo**, publica
un **contrato inmutable en Nostr** (legible por humanos, leíble antes de pagar) y
**reparte** al ganador menos un **fee del 5%** (configurable).

## Ciclo de vida de una apuesta

```
created (contrato Nostr publicado)
  → pending_deposits  (10 min para que TODOS depositen)
       ├─ todos depositaron → ready
       └─ vence sin completar → refunding → cancelled_incomplete
  → ready (se juega)
       → resolución del server (firmada Nostr) dentro de 15 min
            ├─ ganador único → settled (payout ganador − 5%)
            ├─ empate → settled (split del pozo − 5%)
            └─ sin reporte en 15 min → refunding → refunded_timeout
  → cancelled_admin (admin cancela una apuesta NO completa → reembolsa)
```

## Requisitos funcionales

| # | Requisito | MoSCoW | Criterio de aceptación | Depende de |
|---|-----------|--------|------------------------|-----------|
| F1 | El **game server** crea una apuesta (juego, lista de npubs participantes, monto/jugador, condición de victoria, fee%) | Must | Request firmado válido del proveedor dueño del juego → apuesta en `pending_deposits`; monto fuera de [min,max] → rechazo | Auth server |
| F2 | Luna Negra publica el **contrato en Nostr** (inmutable) al crear, antes de cualquier depósito | Must | Cualquiera puede leer el contrato por su id antes de depositar; contenido = apuesta; no cambia después | F1 |
| F3 | Cada participante (logueado Nostr + disclaimer + **acceso al juego**) deposita su monto por Lightning | Must | Solo participantes listados pueden depositar; un depósito por jugador; monto exacto | F1, entitlements |
| F4 | Ventana de **depósito = 10 min**; si no completan todos → reembolso a los que pagaron | Must | A los 10 min sin estar completa → `refunding` → reembolso → `cancelled_incomplete` | F3, worker, reembolso |
| F5 | La apuesta queda **`ready`** cuando deposita el último | Must | Estado pasa a `ready` exactamente al completar los N depósitos | F3 |
| F6 | El **server reporta el ganador firmando con Nostr** dentro de **15 min** desde `ready` | Must | Evento Nostr firmado por el pubkey del proveedor del juego; Luna Negra verifica la firma | F5, auth server |
| F7 | Payout: ganador único cobra **pozo − 5%**; empate → **split** (−5%) entre empatados | Must | Pago Lightning al/los ganador(es); fee retenido; estado `settled`; idempotente | F6, payout |
| F8 | **Timeout de resolución**: sin reporte en 15 min → reembolso total | Must | A los 15 min sin resultado → `refunding` → reembolso → `refunded_timeout` | F5, worker, reembolso |
| F9 | **Reembolso** de depósitos (push Lightning) en incompleto/timeout/cancelación | Must | Cada depositante recibe su monto de vuelta; idempotente; reintentable | Destino de reembolso (ver Q1) |
| F10 | **Worker always-on** que vigila los timers (10/15 min) y dispara reembolsos/payouts | Must | Los timeouts se procesan aunque nadie esté mirando; idempotente; recupera pendientes al reiniciar (estado en DB, no timers en memoria) | Infra |
| F11 | **Cancelación admin** de una apuesta NO completa → reembolsa depósitos | Should | Solo admin; solo en `pending_deposits`; pasa a `cancelled_admin` | F9 |
| F12 | **Panel admin** de apuestas (ver estado, reembolsos/payouts fallidos, reintentar) | Should | Admin ve apuestas y puede reintentar pagos fallidos | F11 |
| F13 | **Disclaimer de apuestas** que el jugador acepta antes de depositar | Must | No se puede depositar sin aceptar el disclaimer | — |

## Requisitos no funcionales

| # | Categoría | Requisito | Métrica |
|---|-----------|-----------|---------|
| NF1 | Infra | Worker always-on para timers (Vercel serverless no alcanza) | Railway/Fly.io/VPS; uptime alto |
| NF2 | Límites (beta) | Monto por jugador | min 5 sats, max 100 sats (configurable por admin) |
| NF3 | Confiabilidad | Reembolsos/payouts idempotentes y reintentables | Ningún doble-pago; ningún fondo trabado tras reinicio |
| NF4 | Auditabilidad | Creación y resultado quedan en Nostr (firmados) | Evento verificable por pubkey del proveedor |
| NF5 | Seguridad | El game server se autentica para crear/resolver | Firma Nostr verificable (detalle en swr-security/api) |

## Usuarios y roles

| Rol | Descripción | Qué puede hacer | Qué NO puede hacer |
|-----|------------|-----------------|---------------------|
| Jugador / apostador | Logueado Nostr, con acceso al juego, acepta disclaimer | Depositar, leer contrato, cobrar si gana | Crear apuestas, resolver, cancelar |
| Game server / proveedor | En Fase 1 = Luna Negra (vos) | Crear apuestas, reportar ganador (firmado) | Tocar el pozo directamente; cobrar más del fee |
| Admin (vos) | Operador | Cancelar apuestas incompletas, reintentar pagos, configurar límites | — |
| Luna Negra (escrow) | Sistema | Custodiar pozo, publicar contrato, repartir/reembolsar, cobrar fee | — |

## Supuestos confirmados

| # | Supuesto | Confirmado |
|---|---------|-----------|
| 1 | N jugadores, mismo monto, winner-takes-all (empate=split) | ✅ |
| 2 | La apuesta la crea el game server; la condición de victoria la define el juego | ✅ |
| 3 | Plazos: depósito 10 min, resolución 15 min | ✅ |
| 4 | Fee 5% configurable; min 5 / max 100 sats (beta) | ✅ |
| 5 | Contrato Nostr inmutable con: juego, npubs, monto, condición, fee%, plazos, reglas de bordes, proveedor responsable | ✅ |
| 6 | Para apostar: login Nostr + disclaimer + acceso al juego | ✅ |
| 7 | Cancelación: solo admin, solo apuesta incompleta, reembolsa | ✅ |

## Preguntas sin resolver (resolver en arquitectura/data)

- **Q1 (crítica): destino del reembolso.** Los pagos Lightning son *push*: para
  reembolsar/pagar a un jugador hace falta una **Lightning Address** o un invoice suyo.
  ¿Se le pide la LN address al apostar? ¿Se usa su `lud16` del perfil Nostr (kind:0)?
  ¿NWC? Sin esto, no hay reembolso ni payout automático.
- **Q2: autenticación del game server** para crear apuesta y reportar resultado
  (firma Nostr con el pubkey del proveedor del juego) — definir el esquema exacto.
- **Q3: ¿qué relays** se usan para publicar el contrato y el resultado, y cómo se
  garantiza que el contrato quede disponible/inmutable (¿relay propio + públicos?).

## Fuera de alcance (Fase 1 — Won't)
- Proveedores terceros (gate de escala: oráculo no confiable).
- Disputas / oráculo descentralizado.
- Multi-ganador top-N, montos variables, fiat.
- Marketing/escala a público general (gate legal).
