# Luna Negra — Plan del MVP

> Tienda de juegos web estilo Steam, con pagos en Lightning/Nostr (sats/BTC).
> **Deadline: 30 de junio 2026** · Desarrollador: 1 (solo).

> **Nota (estado actual):** este documento es el **plan original** del arranque y se
> conserva como referencia de la visión y el cronograma. El MVP ya está **deployado y
> con compra real verificada**, y varias cosas que acá figuran "fuera del MVP" (apuestas/
> escrow, multijugador, email + magic link, NIP-46) **ya están implementadas**. Para el
> estado real al día de hoy mirá **[`ROADMAP.md`](./ROADMAP.md)**. Cambios de infra desde
> entonces: el hosting pasó de **Vercel + Neon** a **self-host con Docker + Cloudflare
> Tunnel**, y el stack a **Next.js 16** (sin shadcn/ui).

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
> Actualizado: varias de estas ya se implementaron post-MVP (ver `ROADMAP.md`).
- ✅ Apuestas / escrow P2P (custodia de pozo, oráculo = server del juego, reembolsos) — **implementado**.
- ✅ Multijugador / unirse a la sala de un amigo (link a lobby del proveedor) — **implementado**.
- ✅ Email + Magic Link (cuentas custodiales) + custodia de claves Nostr / NIP-46 — **implementado**.
- ✅ Propina directa al desarrollador en juegos gratis — **implementado**.
- Suscripción mensual a proveedores; reparto automático multi-proveedor a escala — pendiente.
- Regulación / KYC (explícitamente ignorado en el MVP) — pendiente.

---

## 2. Modelo de negocio
- Comisión por venta de juegos (**reparto 70/30**, 70% proveedor).
- % sobre cada zap/escrow (por defecto **5%, configurable**) — Fase 2.
- Suscripción mensual a proveedores — Fase 2.
- Todo el ecosistema opera en **sats/BTC** sobre Lightning; nada sale a fiat.

---

## 3. Arquitectura

> El diagrama original asumía Vercel serverless. Hoy la app corre en **Docker**
> (Next.js + Postgres en contenedores) y se publica con **Cloudflare Tunnel** (sin IP
> pública). El login además de NIP-07 admite **NIP-46** (firmador en el celu) y **email**.

```
Navegador (Jugador)                         Proveedor
  │  Next.js (App Router)                      │  hostea su juego en su dominio
  │  - login NIP-07 / NIP-46 / email           │  (opcional) consume API de entitlements
  │  - paga invoice LN (QR/LNURL/NWC)          │
  │  - lee amigos/chat/actividad de relays     ▼
  ▼                                       (dominio del proveedor)
Luna Negra Backend (Next.js API routes)
  ├─ Auth NIP-98 → sesión JWT (cookie httpOnly)
  ├─ Catálogo / Biblioteca / Reseñas        → Postgres
  ├─ Pagos: Alby Hub (NWC) make_invoice / lookup_invoice / pay_invoice
  │    └─ al confirmarse: crea entitlement + payout 70% a Lightning Address del proveedor
  ├─ Entitlements API: play-token (firmado) + verify (para el game server)
  └─ /users/known (cruce de npubs con usuarios Luna Negra)

Nostr (relays públicos)  ← amigos (kind:3), DMs (NIP-44/NIP-04), actividad (kind:1 + tag de juego),
                            perfil (kind:0), presencia "jugando" (NIP-38, opcional)
```

### Decisión de hosting (histórico → actual)
- **Original (MVP):** Vercel serverless + Postgres gestionado (Neon/Supabase). Pago verificado por **polling** de `lookup_invoice`; solo relays públicos. Alcanzó para el MVP.
- **Actual:** se migró a **self-host con Docker** (app + Postgres en contenedores) publicado por **Cloudflare Tunnel** (dominio `luna.naranja.fit`). Esto resuelve también el *watcher* always-on que el escrow necesita, sin depender de serverless. El lobby multijugador lo sigue hosteando **el proveedor**.

---

## 4. Stack técnico
> Actualizado al stack real (el plan original decía Next 15 + shadcn/ui + Vercel + Neon).
- **Frontend:** **Next.js 16** (App Router, Turbopack), **React 19**, TypeScript, **Tailwind v4** (UI hand-rolled, **sin shadcn/ui**; rediseño "Eclipse").
- **Nostr:** **`nostr-tools`** como base (perfil kind:0, firma, verificación de eventos); **NDK** (`@nostr-dev-kit/ndk`) para lo social. Login NIP-07 / **NIP-46** (firmador propio que detecta NIP-44/NIP-04).
- **Lightning:** **`@getalby/sdk`** (NWC: make/lookup/pay invoice) + **`@getalby/lightning-tools`** (LNURL / Lightning Address para el payout). `qrcode` para el QR.
- **DB:** **Postgres** + ORM **Prisma**. Imágenes (portadas/screenshots): subida a volumen self-host servido en `/uploads`. La identidad es Nostr (no hay auth de terceros).
- **Auth:** `jose` (JWT). Login estilo **NIP-98**: reto/nonce → firma → verificación → cookie de sesión httpOnly. Además **email (magic link, cuentas custodiales)** vía Resend.
- **Hosting:** **Docker** (app + Postgres) publicado con **Cloudflare Tunnel**. El proveedor hostea su propio juego.

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

### 6.1 Login (3 vías)
1. `POST /api/auth/challenge` → nonce. El usuario firma un evento (kind 27235) con el nonce y `POST /api/auth/verify` valida la firma → upsert en `users` → cookie JWT httpOnly. La firma viene de:
   - **NIP-07**: extensión del navegador (`window.nostr`).
   - **NIP-46**: firmador en el celu (Amber/Primal) emparejado por QR (cliente propio que detecta NIP-44/NIP-04).
2. **Email (magic link)**: `/api/auth/email` manda un link por Resend; al confirmarlo, Luna Negra genera y **custodia** un keypair Nostr (nsec cifrada) y deja la sesión. La identidad es exportable después.
3. Perfil: se lee kind:0 del usuario de relays públicos (nombre, avatar, bio) y se cachea.

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
- **Chat:** DM cifrado (**NIP-44** con fallback **NIP-04**), con caché local por contacto para render instantáneo (migrar a **NIP-17** después por privacidad de metadata).
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
- **NWC y verificación de pago:** la confirmación se hace por **polling** de `lookup_invoice` (no se depende de notificaciones push persistentes). Con el self-host en Docker ya hay proceso always-on para el watcher del escrow.
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
