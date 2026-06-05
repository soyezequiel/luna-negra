# Plan · Refactor de la API para desarrolladores

> Objetivo: que las interfaces que Luna Negra ofrece a los devs de juegos sean
> **lo más estándar posible, fáciles de usar y consistentes** — sin romper
> integraciones y **sin debilitar las garantías de confianza Nostr**.

## Diagnóstico: por qué hoy NO es estándar

Hay **5 formas distintas de autenticarse** y **3 de pasar el token**:

| Endpoint | Auth | Token va en | Error |
|---|---|---|---|
| `GET /api/entitlements/verify` | token suelto | **query** `?token=` | `{ valid:false }` |
| `GET /api/rooms/verify` | token suelto | **query** | `{ valid:false }` |
| `POST /api/rooms/:id/presence` | token | **body** | `{ error }` |
| `POST /api/games/:id/invite` | **cookie** de sesión | — | `{ error }` |
| `POST /api/escrow/bets` | **NIP-98** | header `Authorization` | `{ error, code }` |
| `POST /api/escrow/result` | **evento Nostr firmado** | body | `{ error, code }` |

Problemas:
1. Auth inconsistente (cookie / NIP-98 / evento firmado / token suelto).
2. **Token en query string** → se filtra en logs/proxies.
3. Errores sin forma común (`{valid:false}` vs `{error}` vs `{error,code}`).
4. Sin versionado (`/api/...` mezcla rutas internas de la web con el contrato público).
5. **JWT con HS256 (secreto compartido)** → el dev no puede validar el token offline.
6. Rutas con verbos (`play-token`, `invite`, `result`) en vez de recursos REST.
7. Sin OpenAPI, sin SDK; `DEVELOPERS.md` incompleto (faltan multijugador y apuestas).

## Principios
- **Un solo contrato público y versionado**: `/api/v1/...`, separado de lo interno.
- Una sola forma de autenticar por tipo de operación.
- **`Authorization: Bearer <token>`** siempre (nunca query/body).
- Envelope de error único + códigos HTTP correctos.
- **No romper**: rutas viejas como alias deprecados + ventana de sunset.

---

## ⛔ Invariante dura — no debilitar la confianza Nostr

El refactor de auth es **plomería** (quién puede llamar la API). NO debe tocar las
**garantías de producto** que dependen de Nostr:

1. El **contrato de la apuesta se sigue publicando como evento Nostr firmado e
   inmutable** en relays públicos (`publishContract` → `contractEventId`), para que
   el jugador pueda **leer y verificar los términos** que Luna Negra respetará.
2. El **resultado se sigue firmando con la identidad Nostr del proveedor** (prueba
   del oráculo). Por eso la Fase 4 mantiene la firma Nostr **solo** para el resultado.
3. La verificación **`CONTRACT_MISMATCH` antes de pagar** se mantiene (recalcular el
   hash de términos vs el contrato firmado; si difiere, no se paga).

> En una frase: las API keys facilitan *llamar* a la API, pero **la plata sigue
> protegida por Nostr** (contrato público + resultado firmado + chequeo de hash).

---

## Fase 1 — Consistencia base ✅ HECHO
- ✅ Namespace **`/api/v1/`** para el contrato de devs (entitlements + rooms verify + presence).
- ✅ **Bearer en todo**: token en `Authorization: Bearer` (helper `bearerToken`).
- ✅ **Envelope de error estándar** `{ error: { code, message } }` + helper `apiError` (`src/lib/api.ts`).
- ✅ **CORS unificado** (`corsPreflight`/`apiOk`/`apiError` en `src/lib/api.ts`).
- ✅ **Sin retrocompatibilidad**: rutas viejas eliminadas (pre-launch).
- ✅ **Headers estándar de rate-limit** (`RateLimit-Limit/Remaining/Reset` + `Retry-After`
  en 429) vía `rateLimitHeaders` en `src/lib/rate-limit.ts`, aplicado a los 5 endpoints
  con límite (auth challenge/verify, buy, escrow bets/deposit).

## Fase 2 — Tokens verificables offline (JWKS) ✅ HECHO
- ✅ Tokens de dev (entitlement, invite) de **HS256 → ES256** (asimétrica) — `src/lib/jwks.ts`.
  Los internos (session, challenge, bet-session, withdraw) siguen en HS256.
- ✅ **`/.well-known/jwks.json`** (ruta `/api/v1/jwks` + rewrite en `next.config.ts`).
- ✅ El dev valida el token **offline** con `createRemoteJWKSet` (jose); `/verify`
  queda como conveniencia.
- ✅ **Claims estándar**: `iss`, `aud` (`lunanegra:game`), `sub` (npub), `exp`,
  `scope` (reemplaza `purpose`).
- ✅ Clave: `LN_SIGNING_JWK` (env, obligatoria en prod) o efímera en dev.
- Pendiente menor: rotación con 2 claves en el JWKS (estructura ya lista — el JWKS
  devuelve un array y la verificación resuelve por `kid`).

## Fase 3 — Naming RESTful *(parcial)*
Endpoints internos (cookie) renombrados a recursos, sin retrocompat:
| Antes | Ahora | Estado |
|---|---|---|
| `POST /api/games/:id/play-token` | `POST /api/games/:id/sessions` | ✅ |
| `POST /api/games/:id/invite` (crear/unirse) | `POST /api/games/:id/rooms` + `.../rooms/:roomId/members` | ✅ |
| `POST /api/escrow/bets` | `POST /api/v1/bets` | ⏳ con Fase 4 |
| `POST /api/escrow/result` | `POST /api/v1/bets/:id/result` | ⏳ con Fase 4 |

> Nota: `sessions`/`rooms` quedan bajo `/api/games/...` (no `/v1`) porque son
> endpoints **internos** con cookie del propio web app; `/v1` es el contrato público
> (verify/presence/jwks). Los de escrow son dev-facing → se mueven a `/v1` en Fase 4.

## Fase 4 — Auth server-to-server unificada ✅ HECHO (Opción C híbrida)
- ✅ **API keys** (`ln_sk_…`, guardadas hasheadas): modelo `ApiKey`, lib
  `src/lib/api-keys.ts` (`generateApiKey`/`verifyApiKey`), CRUD en
  `/api/provider/api-keys` + sección en el panel `/provider` (se muestran 1 vez).
- ✅ **`POST /api/v1/bets`** (auth API key) — reemplaza `/api/escrow/bets` (NIP-98).
- ✅ **`POST /api/v1/bets/:id/result`** (auth = **evento Nostr firmado** por el
  proveedor) — reemplaza `/api/escrow/result`. La firma sigue siendo la prueba del
  oráculo; **invariante del contrato intacta** (publish + `CONTRACT_MISMATCH`).
- ✅ Viejas eliminadas; OpenAPI + DEVELOPERS + SDK (`createBet`, `buildResultEvent`,
  `reportResult`) actualizados.

## Fase 5 — Developer Experience *(mayormente HECHO)*
- ✅ **OpenAPI 3.1** como fuente de verdad (`public/openapi.json`).
- ✅ **Referencia navegable** (Scalar vía CDN en `/developers`).
- ✅ **SDK de TS** (`sdk/`, `@lunanegra/sdk`): `verifyAccess()`, `verifyRoom()`
  (validación offline con JWKS). `createBet()`/`reportResult()` se suman con la Fase 4.
- ✅ `DEVELOPERS.md` con multijugador + verificación offline + links a `/developers` y SDK.
- ✅ **`Idempotency-Key`** (estilo Stripe) en `POST /api/v1/bets`: claim-first con
  `IdempotencyKey` (unique), reintento devuelve la respuesta original sin duplicar.
  Lib `src/lib/idempotency.ts`.

## Fase 6 — Webhooks ✅ HECHO
- ✅ Eventos firmados (HMAC-SHA256, cabecera `X-LunaNegra-Signature`) a la URL del
  proveedor: **`purchase.completed`**, **`bet.settled`**, **`payout.sent`**.
- ✅ Entrega vía **QStash** (`QSTASH_TOKEN`, con reintentos) o fetch directo en dev.
  Lib `src/lib/webhooks.ts`; hooks con `after()` en status/dev-pay/payout/bet-result.
- ✅ Config en `/provider` (URL + secreto que se muestra/regenera).
- ✅ SDK `verifyWebhook()`; OpenAPI `webhooks`; DEVELOPERS.md.

---

## Orden sugerido (ROI para dev solo)
1. **Fase 1 + docs** — consistencia (Bearer, errores, CORS) + `DEVELOPERS.md`.
2. **Fase 2 (JWKS)** — el salto más grande hacia estándar.
3. **Fase 5 (OpenAPI + SDK)** — DX.
4. **Fase 3 (REST naming)** con alias.
5. **Fase 4 (API keys)** y **Fase 6 (webhooks)** al final.

## Riesgos
- **No romper integraciones**: todo con `/v1` + alias deprecados + sunset.
- **JWKS**: rotación de claves (2 claves durante el cambio).
- **API keys**: superficie de secretos nueva → guardar **hasheadas**, mostrar 1 sola vez.
- **Invariante Nostr**: tests que aseguren que el contrato se publica y que
  `CONTRACT_MISMATCH` sigue bloqueando el pago.
