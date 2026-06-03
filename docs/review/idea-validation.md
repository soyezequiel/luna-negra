# Validación de Idea — Luna Negra: Apuestas / Escrow

Fecha: 2026-06-03
Tipo de proyecto: negocio (producto real, con revenue por fees)

## La idea en una oración
Permitir que jugadores apuesten sats en partidas de juegos web, con un pozo en
escrow custodiado por Luna Negra y un **contrato publicado en Nostr, legible por
humanos**, que transparenta reglas, participantes y reparto **antes** de pagar;
Luna Negra cobra un fee (~5-10%).

## El problema
| Aspecto | Respuesta |
|---------|-----------|
| ¿Qué problema resuelve? | Jugadores que quieren apostar dinero (sats) en sus partidas no tienen una forma confiable/transparente de hacerlo dentro de un juego web. |
| ¿Quién lo tiene? | Jugadores bitcoiners/Nostr. Señal concreta inicial: el círculo del fundador pide apostar en partidas de Tetris. |
| ¿Qué tan frecuente? | Ocasional / social (demanda amplia aún no validada). |
| ¿Qué tan doloroso? | Molesta / es un "want" social, no un dolor agudo. |
| ¿Cómo lo resuelven hoy? | Apuestas de palabra entre amigos (confianza), o directamente no apuestan. |

## Alternativas evaluadas
| Alternativa | Qué resuelve | Qué no resuelve | Por qué no sirve |
|-------------|-------------|-----------------|------------------|
| Apuesta de palabra entre amigos | Apostar entre conocidos | Transparencia, escala, pago automático | No escala ni genera fees |
| Casas de apuestas / gambling tradicional | Apuestas con dinero real | Nativo BTC/Lightning, juegos web indie, sin KYC | Otro mundo; no integra con la tienda ni Nostr |
| Que cada juego maneje su propia apuesta | Apuesta dentro del juego | Identidad, social, visibilidad, reuso | Cada juego reinventa la rueda; Luna Negra pierde el negocio |

## Supuestos clave
| # | Supuesto | Validado | Cómo validar sin construir |
|---|---------|----------|---------------------------|
| 1 | Hay demanda más allá del círculo del fundador | 🟡 parcial (amigos sí) | Lista de espera / encuesta a usuarios actuales de Luna Negra |
| 2 | Los jugadores confían en el winner-call cuando el proveedor es un tercero | 🔴 no | Solo se valida al abrir a terceros (gate de escala) |
| 3 | La transparencia del contrato Nostr genera suficiente confianza para depositar | 🟡 no | Testeable con el grupo beta de amigos |
| 4 | Operar apuestas de dinero real es viable (legal) al menos en beta cerrada | 🔴 no | Consulta legal puntual (diferida por decisión del usuario) |

## Pivots considerados
| # | Pivot | Ventaja | Desventaja | Decisión |
|---|-------|---------|-----------|----------|
| 1 | Torneos con inscripción + premio | Mismo fee, encuadre legal distinto | No es "apuesta" pura | Rechazado (quiere apuestas) |
| 2 | No-custodial / propinas al ganador | Sin riesgo de custodia | Difícil cobrar fee | Rechazado (quiere fee) |
| 3 | El juego custodia; Luna Negra solo social | Cero custodia/legal | Pierde el negocio del escrow | Rechazado (quiere el escrow) |

## Evaluación
| Dimensión | Señal | Estado |
|-----------|-------|--------|
| Problema real | Demanda concreta a micro-escala (amigos/Tetris); amplia sin validar | 🟡 |
| Solución adecuada | Escrow + contrato Nostr legible resuelve el "want" con transparencia | 🟢 |
| Diferenciador claro | Contrato verificable en Nostr + nativo BTC/Lightning + integrado a la tienda | 🟢 |
| Scope realista | Fase 1 (self-provider, amigos) alcanzable; escrow custodial + worker always-on + bordes es trabajo no trivial para dev solo | 🟡 |

## Recomendación
**CONSTRUIR (acotado a Fase 1: vos como único proveedor, entre conocidos).**

La idea es válida y diferenciada para la etapa beta: la demanda existe a micro-escala,
el contrato en Nostr es un diferenciador genuino y una mitigación real (capa el robo
al fee), y el problema del oráculo está neutralizado mientras vos seas el único
proveedor. La condición es tratar **"abrir a proveedores terceros"** y **"escalar a
desconocidos"** como una puerta separada que exige resolver antes: (a) confianza en el
winner-call de proveedores no controlados, y (b) exposición legal de gambling.

## Gate de escala (no cruzar sin resolver)
1. **Oráculo de terceros** — mecanismo de confianza/disputa cuando el proveedor no es Luna Negra.
2. **Legal/gambling** — consulta jurídica para Argentina + jurisdicciones objetivo antes de abrir a desconocidos.
3. **Custodia a escala** — el disclaimer alcanza para beta entre amigos; no para pozos grandes de público general.
