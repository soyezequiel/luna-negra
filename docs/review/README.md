# Revisión de Software — Luna Negra: Apuestas / Escrow

Estado: **revisión completa** (faltan opcionales: performance, cost, dx, testing, visualizer)
Última actualización: 2026-06-03

> ⚠️ **Snapshot histórico (3 jun 2026).** Estos artefactos reflejan las decisiones del
> momento de la revisión. La infraestructura cambió después: el hosting pasó de
> **Vercel + Neon** a **self-host con Docker + Cloudflare Tunnel** (ver
> [`DEPLOY.md`](../../DEPLOY.md)). Donde estos documentos digan "Vercel"/"Neon", leelo
> como "la app/Postgres del self-host". El resto del análisis sigue vigente.

## Artefactos generados

| Archivo | Generado por | Fecha | Descripción |
|---------|-------------|-------|-------------|
| [idea-validation.md](idea-validation.md) | swr-idea | 2026-06-03 | Validación de la idea de apuestas/escrow. Veredicto: CONSTRUIR (acotado a Fase 1). |
| [proposal.md](proposal.md) | swr-requirements | 2026-06-03 | Requisitos (MoSCoW), ciclo de vida, roles, criterios de aceptación. |
| [decisions/architecture.md](decisions/architecture.md) | swr-architecture | 2026-06-03 | Componentes, "worker" vía scheduler+endpoint, dueño único del dinero, cascada de destino de pago. |
| [decisions/design.md](decisions/design.md) | swr-design | 2026-06-03 | Modal embebido + sección Apuestas, estados de UI, cobro/QR, contrato Nostr como trust anchor. |
| [decisions/data-model.md](decisions/data-model.md) | swr-data | 2026-06-03 | Bet/BetParticipant/LedgerEntry, msat BigInt, ledger append-only, anti-doble-gasto, invariante anti-insolvencia. |
| [diagrams/er-core-models.mmd](diagrams/er-core-models.mmd) | swr-data | 2026-06-03 | Diagrama ER de las entidades de apuestas. |
| [diagrams/sequence-bet-deposit.mmd](diagrams/sequence-bet-deposit.mmd) | swr-api | 2026-06-03 | Secuencia: crear → depositar → ready/reembolso. |
| [diagrams/sequence-bet-resolve.mmd](diagrams/sequence-bet-resolve.mmd) | swr-api | 2026-06-03 | Secuencia: resolución/payout vs timeout/reembolso. |
| [decisions/security.md](decisions/security.md) | swr-security | 2026-06-03 | STRIDE: firma del resultado, scope del Bearer, fee fijado por LN, NWC budget, anti-doble-cobro. |
| [summary.md](summary.md) | swr-review | 2026-06-03 | Resumen ejecutivo: decisiones por dominio, riesgos, próximo paso. |

## Riesgos abiertos

Ver: [docs/review/risks/registry.md](risks/registry.md)
