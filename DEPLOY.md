# Deploy a producción — Luna Negra

La producción corre **self-host con Docker** (app Next 16 + Postgres en contenedores)
publicada a internet con **Cloudflare Tunnel** (sin IP pública ni abrir puertos).

- **Paso a paso para levantarlo:** [`docker/TUTORIAL.md`](docker/TUTORIAL.md) (de cero a online).
- **Referencia corta de operación:** [`docker/README.md`](docker/README.md).

Este documento es **la parte que no depende del host**: las **variables de entorno**
y los **servicios externos** (Lightning, apuestas, monitoreo) que configurás en
tu `.env.docker`. Sirve igual si en vez de Docker corrés la app en otro lado.

---

## 0. Variables de entorno

Se cargan en `.env.docker` (self-host) o en el entorno de tu host. **Cada cambio
requiere reiniciar/reconstruir** el contenedor.

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `JWT_SECRET` | Firma las sesiones (cookie) y los challenges de login | ✅ (la app no arranca sin esto en prod) |
| `LN_SIGNING_JWK` | Clave **ES256** que firma los tokens de acceso (entitlement) e invitación que el game server valida offline contra `/.well-known/jwks.json` | ✅ en prod |
| `DATABASE_URL` / `DIRECT_URL` | Postgres (en Docker se fuerzan al Postgres del compose; solo importan si usás una DB externa) | ✅ (las setea el compose) |
| `NEXT_PUBLIC_SITE_URL` | URL pública canónica (la del túnel); va en los anuncios Nostr | ➖ (se infiere del request si falta) |
| `ADMIN_PUBKEY` | Pubkey **hex** de quien entra a `/admin`. Sin esto en prod, **nadie** es admin | ✅* |
| `NWC_CONNECTION_STRING` | Wallet Lightning (cobra ventas/apuestas, paga premios) | ✅** |
| `NWC_CONNECTION_STRING_FALLBACK` | Wallet de respaldo si el primario falla | ➖ |
| `ORACLE_ENC_KEY` | Clave maestra que **cifra** la clave del oráculo gestionado (con la que Luna Negra firma resultados/actividad por API key) | ✅ si usás apuestas |
| `LUNA_NEGRA_NSEC` | Identidad Nostr del server que firma el contrato de apuesta | ✅*** |
| `BET_MIN_SATS` / `BET_MAX_SATS` / `BET_FEE_PCT` / `BET_FEE_MIN_SATS` | Config de apuestas | ➖ (default 5 / 100 / 5 / 1) |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | Verifican el tick del escrow | ✅*** |
| `QSTASH_TOKEN` | Publicar webhooks a proveedores con reintentos | ➖ |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Rate-limit compartido | ➖ (sin esto, rate-limit en memoria) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores | ➖ (sin DSN queda inerte) |
| `DISCORD_WEBHOOK_URL` | Aviso al equipo cuando entra un juego a revisión | ➖ |

\* Sin `ADMIN_PUBKEY`, nadie es admin en prod. · \** Sin NWC, los pagos no funcionan
(no hay modo dev en prod). · \*** Solo si usás las **apuestas**.

> Las imágenes (portadas/capturas) se guardan en un **volumen self-host** (`/app/uploads`,
> servidas en `/uploads`). Ya **no** se usa Vercel Blob: no hay token de imágenes que setear.
>
> El **login por email** (magic link) no está en esta lista a propósito: existe en código
> pero **no está operativo** — no configures Resend esperando que funcione el login.

---

## 1. Secretos base (siempre)

```bash
# JWT_SECRET — firma sesiones (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# LN_SIGNING_JWK — clave ES256 que firma los tokens para el game server
node -e "const{generateKeyPair,exportJWK}=require('jose');(async()=>{const{privateKey}=await generateKeyPair('ES256',{extractable:true});const j=await exportJWK(privateKey);j.kid='ln-1';j.alg='ES256';j.use='sig';console.log(JSON.stringify(j))})()"
```

`ADMIN_PUBKEY` es tu pubkey en **hex** (no el `npub`). Convertilo:

```bash
node --input-type=module -e "import {nip19} from 'nostr-tools'; console.log(nip19.decode('npub1TUYO').data)"
```

---

## 2. Lightning — Alby Hub (NWC)

Solo si vas a mover plata (compras y/o apuestas).

1. [hub.getalby.com](https://hub.getalby.com) → creá/abrí tu wallet (sin hardware).
2. Creá una **conexión NWC** con permisos: *make invoice, lookup invoice, pay invoice,
   get balance*. **Ponele un budget/límite de gasto** (red de seguridad).
3. Copiá el string `nostr+walletconnect://…` → `NWC_CONNECTION_STRING`.
   (Opcional: una segunda wallet en `NWC_CONNECTION_STRING_FALLBACK`.)

---

## 3. Apuestas / escrow (opcional, Fase C)

1. **Identidad del server** que firma el contrato:
   ```bash
   node -e "const {generateSecretKey,nip19}=require('nostr-tools'); console.log(nip19.nsecEncode(generateSecretKey()))"
   ```
   → `LUNA_NEGRA_NSEC`.
2. **`ORACLE_ENC_KEY`** (32 bytes): cifra la clave del **oráculo gestionado** con el que
   Luna Negra firma resultados/actividad por API key. Generala:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Tras setearla en prod, backfilleá los proveedores existentes:
   ```bash
   node prisma/scripts/backfill-oracle-keys.mjs
   ```
3. **Tick del escrow** (vigila depósitos/timeouts): un schedule de **Upstash QStash**
   que hace `POST https://<tu-dominio>/api/escrow/tick` cada pocos minutos. Funciona
   igual contra la URL del túnel de Cloudflare. Copiá las **Signing Keys** →
   `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`. Detalle en
   [`docs/qstash-setup.md`](docs/qstash-setup.md).
4. Config (opcional): `BET_MIN_SATS` (5), `BET_MAX_SATS` (100), `BET_FEE_PCT` (5),
   `BET_FEE_MIN_SATS` (1).

---

## 4. Opcionales de operación

- **Rate-limit compartido (Upstash Redis):** creá un Redis en
  [upstash.com](https://upstash.com) → `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`. Sin esto, el rate-limit usa memoria (ok para una sola
  instancia self-host).
- **Monitoreo (Sentry):** creá un proyecto en sentry.io y poné el **mismo DSN** en
  `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN`. Sin DSN, Sentry queda inerte.
- **Discord:** `DISCORD_WEBHOOK_URL` para el aviso de juegos en revisión.

---

## 5. Migraciones y datos

- **Self-host (Docker):** las migraciones (`prisma migrate deploy`) se aplican **solas**
  al arrancar el contenedor `app` (ver [`docker/entrypoint.sh`](docker/entrypoint.sh)).
  Para datos de ejemplo en el primer arranque, poné `SEED_ON_START=true`.
- **DB externa (sin Docker):** una vez, con las URLs en tu entorno:
  ```bash
  npx prisma migrate deploy   # crea/actualiza todas las tablas
  npm run db:seed             # opcional: juegos de ejemplo
  ```

---

## 6. Checklist de seguridad

- [ ] `JWT_SECRET` fuerte y único; `LN_SIGNING_JWK` generada y estable.
- [ ] `ADMIN_PUBKEY` seteado (si no, nadie es admin).
- [ ] **Budget cap** puesto en el NWC de Alby Hub; rotalo si lo compartiste.
- [ ] `ORACLE_ENC_KEY` guardada y respaldada: si la perdés, no podés descifrar la
      clave del oráculo gestionado.
- [ ] Secretos solo en `.env.docker`; nunca commitear `.env*` (ya gitignoreado).
- [ ] Incluí `./uploads` y los backups de Postgres en tu rutina de respaldo.
- [ ] **Gates** antes de abrir las apuestas a desconocidos: oráculo de terceros + lo
      legal (ver [`docs/review/`](docs/review/)).
- [ ] Recordá: el chat (NIP-44/NIP-04) expone metadata; migrar a **NIP-17** post-lanzamiento.

---

## 7. Gotchas

- **El retiro por QR (LNURL-withdraw)** y cualquier callback de wallet externa **solo
  funciona con URL pública** → no se prueba desde `localhost`. El cobro por **lud16**
  (Lightning Address en el perfil) sí, porque el pago **sale** del Alby Hub.
- En `cloudflared`, el servicio del túnel apunta a `app:3000` (red interna de Docker),
  **no** a `localhost`.
- Cambiar una variable **requiere reconstruir/reiniciar** el contenedor para tomar efecto.
</content>
