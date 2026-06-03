# Roadmap post-MVP — Luna Negra

El MVP está **deployado y con compra real verificada**. Esto es lo que falta,
ordenado por prioridad. Esfuerzo: **S** (horas) · **M** (1-2 días) · **L** (varios días).

> Orden recomendado: **A → B** (hacer el producto actual sólido y lanzable),
> y después **C** (la feature estrella: apuestas). D y E son ampliaciones.
> Si el objetivo es **mostrar el diferenciador** cuanto antes, hacé un A mínimo y saltá a C.

---

## Fase A — Completar el MVP (que sea usable de verdad)
Lo que ya existe pero le faltan piezas para que un proveedor/jugador real lo use.

- **A1 · Gestión de juegos del proveedor** ✅ (hecho): editar, **despublicar** y borrar; editar precio/descripción/URL después de crear.
- **A2 · Subida de imágenes** ✅ (hecho): portada + screenshots con **Vercel Blob** (con fallback a pegar URL). Requiere activar Blob en Vercel.
- **A3 · Payout robusto** ✅ (hecho): **reintento** de payouts en `failed` + panel en `/admin` + sección de ventas en `/provider`.
- **A4 · Cachear perfil** ✅ (hecho): guarda `displayName`/`avatar` (kind:0) al login → nombre real en navbar, reseñas, amigos.
- **A5 · Tienda navegable** ✅ (hecho): **búsqueda** + **paginación**. (Categorías/tags quedan pendientes — falta campo en el modelo.)
- **A6 · Admin completo** ✅ (hecho): **rechazar** + link de admin gateado en el nav.

> **Fase A completa** 🎉 (queda solo categorías/tags, opcional).

## Fase B — Listo para público (robustez y operación)
- **B1 · Rate-limit real** ✅ (hecho): Upstash Redis con fallback a memoria (`checkRateLimit`). Falta setear las env vars de Upstash en Vercel para activarlo.
- **B2 · Monitoreo de errores** ⏳ (pendiente): **Sentry** — necesita cuenta/DSN y tocar la config de build; hacer con cuidado.
- **B3 · Dominio propio** ✅ (documentado en DEPLOY.md): acción en el dashboard de Vercel.
- **B4 · Términos y privacidad** ✅ (hecho): `/terms` y `/privacy` + links en el footer.
- **B5 · Tests automatizados** ✅ (hecho): Vitest, 13 tests (auth/JWT, format, admin). `npm test`.
- **B6 · Backups/PITR** ✅ (documentado en DEPLOY.md): acción en el dashboard de Neon.

## Fase C — Feature estrella: apuestas / escrow ⭐
La razón de ser de Luna Negra. La más delicada. **Necesita un servicio always-on**
(Railway/Fly.io) aparte de Vercel para vigilar pagos y timeouts.

- **C0 · Diseño + `swr-review`** ✅ (hecho): revisión completa en [`docs/review/`](docs/review/) (idea→requisitos→arquitectura→diseño→datos→API→seguridad). **Plan de implementación: [`docs/apuestas-plan.md`](docs/apuestas-plan.md)** (M0–M7). Gates antes de escalar: oráculo 3ros, legal, custodia.
- **C1 · Modelo de datos** (S): apuestas, participantes, pozo, resultado, estados.
- **C2 · Depósitos al pozo** (M): el juego crea una apuesta; los jugadores depositan (zap/invoice); Luna Negra **custodia** el pozo.
- **C3 · Resolución y reparto** (M): el game server reporta ganador(es) → Luna Negra **paga a los ganadores** menos el fee (5% configurable).
- **C4 · Bordes** (M): empate, cancelación, **timeout**, reembolso, payout fallido (idempotente).
- **C5 · Confianza/disputas** (L): mitigar el oráculo (ventana de disputa, límites, reputación del proveedor).

## Fase D — Multijugador / jugar con amigos
- **D1 · "Unirse a la sala"** (M): Luna Negra emite un **invite token** y un endpoint para que el jugador entre al lobby del proveedor (similar a entitlements).
- **D2 · Contrato para proveedores** (S): documentar cómo exponen su lobby WebSocket y validan el token.
- **D3 · Presencia mejorada** (S): auto-publicar NIP-38 "jugando X" al lanzar un juego.
- Infra: el lobby lo hostea el proveedor; si Luna Negra hace señalización, necesita always-on.

## Fase E — Inclusión y cuentas
- **E1 · Email + Magic Link** (M): para usuarios no-técnicos.
- **E2 · Custodia de claves Nostr** (L): NIP-46 (bunker) o signer server-side, compatible con NIP-07 (nos2x) que ya está.
- **E3 · Chat NIP-17** (M): reemplazar NIP-04 (que expone metadata).

---

## Implicaciones de infraestructura
- **Vercel alcanza** para A, B, D1-D3 y la mayor parte de E.
- **C (apuestas)** y señalización de **D** necesitan un **worker always-on** (Railway / Fly.io / VPS) además de Vercel.

## Próximo sprint sugerido
**A1 + A3 + A4** (gestión de juegos + payout robusto + nombres reales): es lo que más
se nota para proveedores y jugadores reales, y es de bajo riesgo. Después B1-B3 para
poder abrirlo al público, y recién ahí C.
