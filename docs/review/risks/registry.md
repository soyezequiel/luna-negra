# Registro de riesgos — Apuestas / Escrow

| # | Origen | Riesgo | Impacto | Estado | Mitigación |
|---|--------|--------|---------|--------|-----------|
| R1 | swr-idea | Oráculo: con proveedores terceros, un server malicioso declara ganador falso entre participantes | Alto | aceptado (beta) | Fase 1 solo self-provider; contrato Nostr capa el reparto al ≤10% fee; gate antes de abrir a terceros |
| R2 | swr-idea | Legal/gambling: apuestas de dinero real + fee = operar gambling (Argentina + escala) | Alto | aceptado (beta) | Diferido por decisión del usuario; consulta legal antes de expandir a desconocidos |
| R3 | swr-idea | Custodia: Luna Negra sostiene el pozo (riesgo de contraparte Alby + seguridad + responsabilidad) | Alto | aceptado (beta) | Disclaimer de beta "no nos hacemos cargo"; pozos chicos entre conocidos; gate a escala |
| R4 | swr-idea | Demanda amplia no validada (señal solo en el círculo del fundador) | Medio | sin resolver | Validar con usuarios reales de Luna Negra antes de invertir en la versión madura |
| R5 | swr-requirements | Destino de reembolso/payout: los pagos Lightning son push; sin LN address/invoice del jugador no se puede devolver ni pagar | Alto | mitigado | Cascada A5: lud16 (kind:0) → NWC → exigir LN address en perfil → QR de retiro (LNURL-withdraw) |
| R6 | swr-requirements | Worker always-on: si se cae, los timeouts (10/15 min) y reembolsos no se procesan | Medio | mitigado | A1/A3: timers por timestamp en DB + idempotencia + scheduler externo que recupera pendientes en cada tick |
| R7 | swr-architecture | Wallet compartido tienda+pozos: blast radius + posible insolvencia si un bug paga de más | Alto | aceptado (beta) | Invariante DB (no pagar > depositado por apuesta); montos chicos; wallet separado a escala |
| R8 | swr-architecture | Disponibilidad/inmutabilidad del contrato en relays públicos | Medio | aceptado (beta) | Publicar en varios relays; relay propio a futuro |
| R9 | swr-design | Retiro (QR) no reclamado en 60 min → sats forfeited; el jugador pierde lo ganado y quedan sats huérfanos | Medio | aceptado (beta) | Aviso claro + countdown; registrar `forfeited` en DB |
| R10 | swr-design/security | Modal embebido: un juego malicioso podría falsificar el modal y phishear depósitos | Medio | aceptado (beta) | Fase 1 el único proveedor es Luna Negra (no hay game ajeno); confirmación de pago first-party = **gate antes de abrir a 3ros** |
| R11 | swr-data | Unidad de dinero inconsistente: tienda en sats (Int), apuestas en msat (BigInt) → bug de conversión | Medio | sin resolver | Sufijo `Msat` en columnas + helpers de conversión + tests |
| R12 | swr-api | LNURL-withdraw = superficie extra (callbacks, token de un solo uso, ventana) | Medio | aceptado (beta) | Solo fallback; montos chicos; degradar a "pegá tu LN address" si pesa |
| R13 | swr-security | El bet-session token es legible por el game host (se pasa por postMessage) | Medio | mitigado | Mínimo privilegio (no redirige fondos) + exp corta; destino de cobro sale del perfil/wallet, no del token |
