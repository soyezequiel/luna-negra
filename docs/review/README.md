# Revisión de Software — Luna Negra: Apuestas / Escrow

Estado: en revisión
Última actualización: 2026-06-03

## Artefactos generados

| Archivo | Generado por | Fecha | Descripción |
|---------|-------------|-------|-------------|
| [idea-validation.md](idea-validation.md) | swr-idea | 2026-06-03 | Validación de la idea de apuestas/escrow. Veredicto: CONSTRUIR (acotado a Fase 1). |
| [proposal.md](proposal.md) | swr-requirements | 2026-06-03 | Requisitos (MoSCoW), ciclo de vida, roles, criterios de aceptación. |
| [decisions/architecture.md](decisions/architecture.md) | swr-architecture | 2026-06-03 | Componentes, "worker" vía scheduler+endpoint, dueño único del dinero, cascada de destino de pago. |
| [decisions/design.md](decisions/design.md) | swr-design | 2026-06-03 | Modal embebido + sección Apuestas, estados de UI, cobro/QR, contrato Nostr como trust anchor. |
| [decisions/data-model.md](decisions/data-model.md) | swr-data | 2026-06-03 | Bet/BetParticipant/LedgerEntry, msat BigInt, ledger append-only, anti-doble-gasto, invariante anti-insolvencia. |
| [diagrams/er-core-models.mmd](diagrams/er-core-models.mmd) | swr-data | 2026-06-03 | Diagrama ER de las entidades de apuestas. |
| [decisions/api-contracts.md](decisions/api-contracts.md) | swr-api | 2026-06-03 | Endpoints, auth (Bearer en modal vs cookie), error codes, sesión cross-origin del modal. |
| [diagrams/sequence-bet-deposit.mmd](diagrams/sequence-bet-deposit.mmd) | swr-api | 2026-06-03 | Secuencia: crear → depositar → ready/reembolso. |
| [diagrams/sequence-bet-resolve.mmd](diagrams/sequence-bet-resolve.mmd) | swr-api | 2026-06-03 | Secuencia: resolución/payout vs timeout/reembolso. |
| [decisions/security.md](decisions/security.md) | swr-security | 2026-06-03 | STRIDE: firma del resultado, scope del Bearer, fee fijado por LN, NWC budget, anti-doble-cobro. |

## Riesgos abiertos

Ver: [docs/review/risks/registry.md](risks/registry.md)
