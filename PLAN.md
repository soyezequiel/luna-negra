# Luna Negra — Plan del MVP

> Tienda de juegos web estilo Steam, con pagos en Lightning/Nostr (sats/BTC).
> **Deadline: 30 de junio 2026** · Desarrollador: 1 (solo) · Hoy: 2 de junio 2026.

---

## 1. Visión y alcance

**Luna Negra** es una tienda de juegos **100% web** (sin instalar nada; solo navegador). Tiene **dos tipos de cliente**:

- **Jugador**: navega, compra y juega; tiene biblioteca, perfil, amigos, chat y feed de actividad.
- **Proveedor de juegos**: publica juegos (autoservicio con revisión), hostea su propio juego y su lobby; cobra a través de Luna Negra.

Luna Negra aporta **visibilidad** + **APIs que le simplifican la vida al proveedor** (entitlements, acceso a lobby por link, escrow de apuestas, social). El host de Luna Negra **no corre nodo propio**: usa un wallet Lightning de terceros (Alby Hub vía NWC).

### Qué entra en el MVP (30 jun)
- Tienda + catálogo + página de juego.
- Login **Nostr (NIP-07 / nos2x/Alby)**.
- **1 juego demo** propio (lo construimos) que prueba el flujo real comprar → acceder → jugar.
- **Pago Lightning de compra** con reparto **custodial 70/30** (Luna Negra cobra y reenvía el 70% al proveedor).
- Biblioteca + perfil de usuario.
- Reseñas y ratings.
- Amigos (follows de Nostr, con usuarios de Luna Negra arriba).
- Chat (DM de Nostr) + feed de actividad por juego (eventos Nostr en relays públicos).

### Fuera del MVP (Fase 2+)
- Apuestas / escrow P2P (custodia de pozo, oráculo = server del juego, reembolsos).
- Multijugador / unirse a la sala de un amigo (link a lobby WebSocket del proveedor).
- Email + Magic Link + custodia/firma de claves Nostr para no-técnicos.
- Suscripción mensual a proveedores; reparto automático multi-proveedor a escala.
- Regulación / KYC (explícitamente ignorado en el MVP).

---

## 2. Modelo de negocio
- Comisión por venta de juegos (**reparto 70/30**, 70% proveedor).
- % sobre cada zap/escrow (por defecto **5%, configurable**) — Fase 2.
- Suscripción mensual a proveedores — Fase 2.
- Todo el ecosistema opera en **sats/BTC** sobre Lightning; nada sale a fiat.

---

## 3. Arquitectura

```
Navegador (Jugador)                         Proveedor
  │  Next.js (React) en Vercel                 │  hostea su juego en su subdominio
  │  - NIP-07 (window.nostr) login             │  (opcional) consume API de entitlements
  │  - paga invoice LN (QR/LNURL/NWC)          │
  │  - lee amigos/chat/actividad de relays     ▼
  ▼                                       game.lunanegra.app
Luna Negra Backend (Next.js API routes, serverless)
  ├─ Auth NIP-98 → sesión JWT (cookie httpOnly)
  ├─ Catálogo / Biblioteca / Reseñas        → Postgres
  ├─ Pagos: Alby Hub (NWC) make_invoice / lookup_invoice / pay_invoice
  │    └─ al confirmarse: crea entitlement + payout 70% a Lightning Address del proveedor
  ├─ Entitlements API: play-token (firmado) + verify (para el game server)
  └─ /users/known (cruce de npubs con usuarios Luna Negra)

Nostr (relays públicos)  ← amigos (kind:3), DMs (NIP-04), actividad (kind:1 + tag de juego),
                            perfil (kind:0), presencia "jugando" (NIP-38, opcional)
```

### Decisión sobre Vercel (lo que pediste evaluar)
- **MVP: Vercel alcanza perfecto.** Next.js + API routes serverless + verificación de pago por **polling** de `lookup_invoice` + solo relays públicos (no hosteamos relay). Postgres gestionado externo.
- **Límite (Fase 2):** los WebSockets del multiplayer y el *watcher* always-on del escrow **no** corren bien en serverless. Para esas fases sumás un servicio persistente aparte (**Railway / Fly.io / Render / VPS**). El lobby multijugador, además, **lo hostea el proveedor**, no Luna Negra.
- **Conclusión:** arrancá en Vercel; no te bloquea para el 30 de junio.

---

## 4. Stack técnico
- **Frontend:** Next.js 15 (App Router), React, TypeScript, **Tailwind + shadcn/ui** (UI oscura estilo Steam rápida).
- **Nostr:** **NDK** (`@nostr-dev-kit/ndk`) — manejo de relays, firma NIP-07, suscripciones (amigos, DMs, actividad). `nostr-tools` como apoyo.
- **Lightning:** **`@getalby/sdk`** (NWC: make/lookup/pay invoice) + **`@getalby/lightning-tools`** (LNURL / Lightning Address para el payout). `qrcode` para el QR.
- **DB:** **Supabase** (Postgres + Storage para portadas/screenshots; free tier generoso) o **Neon**. ORM **Prisma** (DX rápida) o Drizzle. *No* usamos Supabase Auth (la identidad es Nostr).
- **Auth:** `jose` (JWT). Login estilo **NIP-98**: reto/nonce → firma con `window.nostr.signEvent` → verificación → cookie de sesión.
- **Hosting:** Vercel (web + API). Juego demo: deploy estático aparte en subdominio.

---

## 5. Modelo de datos (Postgres)

- **users**: `id, npub (unique), pubkey_hex, display_name (cache de kind:0), avatar_url, created_at, last_seen`
- **providers**: `id, owner_user_id, name, lightning_address (payout), status (pending/approved), created_at`
- **games**: `id, provider_id, slug, title, description, price_sats (0 = gratis), cover_url, screenshots[], game_url (subdominio), status (draft/in_review/published), revenue_share (default 70), created_at`
- **purchases** (entitlements): `id, user_id, game_id, amount_sats, invoice_id, payment_hash, status (pending/paid/failed), payout_status, payout_hash, created_at, paid_at`
- **reviews**: `id, user_id, game_id, rating (1-5), body, created_at` (única por user+game)

Social (amigos, chat, actividad) **no se guarda en DB**: vive en relays Nostr. Único apoyo de DB: cruzar npubs con `users` para ordenar amigos.

---

## 6. Flujos clave

### 6.1 Login (NIP-07)
1. `window.nostr.getPublicKey()` → npub.
2. `POST /api/auth/challenge` → nonce. Usuario firma un evento (kind 27235) con el nonce.
3. `POST /api/auth/verify` → backend valida firma → upsert en `users` → cookie JWT httpOnly.
4. Perfil: se lee kind:0 del usuario de relays públicos (nombre, avatar, bio).

### 6.2 Compra con reparto custodial 70/30
1. `POST /api/games/[id]/buy` → backend pide invoice a Alby Hub vía NWC (`make_invoice`) → devuelve `bolt11 + QR + LNURL + invoiceId`.
2. El jugador paga: con su wallet NWC conectada **o** escaneando el QR / pegando la LNURL.
3. Frontend hace **polling** a `GET /api/purchases/[invoiceId]/status` → backend consulta `lookup_invoice`.
4. Al confirmarse: crear **entitlement** (`status=paid`) → disparar **payout**: resolver Lightning Address del proveedor → pedir invoice del 70% → `pay_invoice`. El 30% queda en el wallet de Luna Negra. Registrar `payout_status` con **idempotencia** y reintentos.

### 6.3 Jugar (entitlements API)
1. `POST /api/games/[id]/play-token` → si el usuario es dueño (o el juego es gratis), devuelve **JWT corto** `{ npub, gameId, owns:true, exp }` firmado por Luna Negra.
2. Se abre el juego en su subdominio con el token (query param / postMessage).
3. (Opcional para el proveedor) El game server llama `GET /api/entitlements/verify?token=...` → `{ npub, gameId, owns }`. Si no usa la API, el juego queda abierto igual.

### 6.4 Social vía Nostr (sin backend pesado)
- **Amigos:** leer kind:3 del usuario → cruzar con `GET /api/users/known?npubs=...` → usuarios de Luna Negra arriba, mostrando qué juegos tienen.
- **Actividad por juego:** notas kind:1 con tag de juego (ej. `["t","lunanegra:game:<id>"]`); las de proveedor llevan `["l","update"]`. Postean ambos. Feed en la página del juego.
- **Chat:** DM **NIP-04** vía `window.nostr.nip04` (rápido para MVP; migrar a **NIP-17** después por privacidad).
- **Presencia "jugando ahora" (opcional):** al abrir un juego, publicar **NIP-38** (kind 30315) con el juego; los amigos lo ven.

---

## 7. Cronograma a 30 de junio (~4 semanas, solo)

### Días 1–3 (2–4 jun) · Fundaciones
- Repo + Next.js + TS + Tailwind + shadcn; layout oscuro estilo Steam; routing.
- Schema DB + ORM + seed.
- Wallet Alby Hub creada; NWC en env; **smoke test real**: crear invoice + pagar monto chico + `lookup_invoice`.
- Login NIP-07 end-to-end (challenge/verify/JWT) + perfil desde kind:0.

### Semana 1 (5–11 jun) · Tienda + compra ← *riesgo #1*
- Catálogo (grid store) + página de juego (precio, descripción, screenshots).
- Flujo de compra completo: invoice → modal QR/LNURL/NWC → polling → entitlement.
- **Payout 70%** automático a Lightning Address del proveedor; registrar 30%.
- Biblioteca ("mis juegos").
- **Hito: comprar un juego de punta a punta funciona.**

### Semana 2 (12–18 jun) · Juego demo + entitlements + panel proveedor
- API de entitlements (play-token + verify).
- **Juego demo HTML5** en subdominio que consume la API → flujo comprar→acceder→jugar real.
- Panel proveedor: alta de juego (draft), subir portada/screenshots, enviar a revisión; vista admin para aprobar.
- Reseñas y ratings (DB).

### Semana 3 (19–25 jun) · Social vía Nostr
- Amigos (kind:3 + `/users/known`, orden Luna Negra arriba).
- Feed de actividad por juego (leer/publicar kind:1 con tag; updates de proveedor).
- Chat DM (NIP-04): lista de conversaciones + ventana.
- (Opcional) presencia "jugando" NIP-38.

### Semana 4 (26–30 jun) · Pulido + deploy + pruebas
- Pulido visual, estados de carga/error, responsive.
- **Pruebas reales del flujo de dinero** (montos chicos): pago, fallo de pago, invoice expirada, payout fallido.
- Deploy a producción (dominio + subdominio del juego), variables, hardening básico (rate-limit en endpoints de pago, validación de firma).
- Doc corta para proveedores (cómo integrar entitlements). Buffer.

---

## 8. Riesgos y avisos honestos
- **Alcance:** 4 features sociales + pago custodial en 4 semanas solo es ambicioso. Es viable apoyándose 100% en Nostr. **Orden de recorte si te atrasás (sin tocar el dinero):** chat → actividad → amigos.
- **Payout custodial:** Luna Negra sostiene fondos un instante y paga al proveedor; hay que manejar **fallos de payout** (reintentos, idempotencia) y Lightning Address caídas.
- **NWC en serverless:** las *notificaciones push* de NWC necesitan conexión persistente → en Vercel usá **polling** (o webhook de Alby). El worker always-on llega con escrow/multiplayer.
- **NIP-04** expone metadata; migrar a **NIP-17** post-MVP.
- **Oráculo de apuestas (Fase 2):** confiar en el server del proveedor permite que uno malicioso mienta y se quede con el pozo; va a necesitar disputas/garantías.
- **Sin regulación:** ok para el MVP como pediste, pero custodia de fondos + apuestas P2P = exposición legal real antes de abrir al público.

---

## 9. Backends Lightning sin nodo propio (referencia)
- **Alby Hub / NWC** — elegido. Hosteado por Alby, sin hardware; API limpia de invoice/pay.
- **ZBD** — API pensada para juegos (buen encaje a futuro).
- **Coinos** — custodial con Nostr/zaps y API.
- **LNbits hosteado** — clave para la fase de **escrow** (sub-wallets por usuario).
- **Voltage / Greenlight (Blockstream) / Phoenixd** — nodos gestionados/no-custodial si más adelante querés menos dependencia de terceros.
