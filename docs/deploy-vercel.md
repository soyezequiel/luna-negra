# Deploy completo en Vercel — Luna Negra

Guía paso a paso para deployar Luna Negra desde cero, con **todas** las integraciones:
Postgres (Neon), Vercel Blob (imágenes), Upstash Redis (rate-limit), Upstash QStash
(tick de apuestas), Lightning (Alby Hub/NWC) y los secretos.

> El orden importa: creás los servicios → cargás sus variables en Vercel → deployás →
> aplicás migraciones → verificás.

---

## 0. Resumen de variables de entorno

| Variable | Para qué | Obligatoria | De dónde sale |
|----------|----------|-------------|---------------|
| `DATABASE_URL` | DB (conexión **pooler**) | ✅ | Neon |
| `DIRECT_URL` | DB (conexión **directa**, migraciones) | ✅ | Neon |
| `JWT_SECRET` | Firmar sesiones/tokens | ✅ | lo generás vos |
| `ADMIN_PUBKEY` | Quién entra a `/admin` (pubkey **hex**) | ✅* | tu cuenta Nostr |
| `NWC_CONNECTION_STRING` | Wallet Lightning (cobros/pagos) | ✅** | Alby Hub |
| `BLOB_READ_WRITE_TOKEN` | Subida de imágenes | ➖ | Vercel Blob (store **público**) |
| `UPSTASH_REDIS_REST_URL` | Rate-limit | ➖ | Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Rate-limit | ➖ | Upstash Redis |
| `QSTASH_CURRENT_SIGNING_KEY` | Verificar el tick de apuestas | ✅*** | Upstash QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Verificar el tick de apuestas | ✅*** | Upstash QStash |
| `LUNA_NEGRA_NSEC` | Firmar el contrato de apuestas (Nostr) | ✅*** | lo generás vos |
| `BET_MIN_SATS` / `BET_MAX_SATS` / `BET_FEE_PCT` | Config de apuestas | ➖ (default 5/100/5) | vos |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores (server / cliente) | ➖ | Sentry (mismo valor en ambas) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Subir source maps en el build | ➖ | Sentry |

\* Sin `ADMIN_PUBKEY` en prod, **nadie** es admin. · \** Sin NWC, los pagos no funcionan
(modo dev no aplica en prod). · \*** Solo si usás las **apuestas**. · Sin `SENTRY_DSN`,
Sentry queda **inerte** (no envía nada) — la app funciona igual.

Todas se cargan en **Vercel → tu proyecto → Settings → Environment Variables**
(entorno **Production**; marcá Preview también si querés previews funcionales).
**Cada vez que cambiás una variable, hace falta Redeploy.**

---

## 1. Base de datos — Neon Postgres
1. Creá un proyecto en [neon.tech](https://neon.tech) (free tier).
2. En **Connection Details** copiá **dos** strings:
   - La que tiene **`-pooler`** en el host → `DATABASE_URL`
   - La **directa** (sin `-pooler`) → `DIRECT_URL`
   *(Si no ves dos, podés usar la misma en ambas.)*
3. Cargá ambas en Vercel.

## 2. Imágenes — Vercel Blob (store PÚBLICO)
1. Vercel → tu proyecto → pestaña **Storage** → **Create Database** → **Blob**.
2. **Importante: elegí acceso PÚBLICO** (un store *private* rompe las portadas — error
   "Cannot use public access on a private store").
3. **Connect to Project** → `luna-negra`.
4. En el store → pestaña **`.env.local`** → **Show secret** → copiá el
   `BLOB_READ_WRITE_TOKEN` → cargalo en Vercel (Production).
5. Sin esto, la subida se desactiva pero podés **pegar URLs** de imágenes igual.

## 3. Rate-limit — Upstash Redis
1. [console.upstash.com](https://console.upstash.com) → **Redis** → Create.
2. Copiá **REST URL** y **REST Token** → `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
3. Sin esto, el rate-limit cae a memoria (no se comparte entre instancias serverless).

## 4. Tick de apuestas — Upstash QStash
Solo si usás las **apuestas**. (Detalle ampliado en `docs/qstash-setup.md`.)
1. Upstash → **QStash** → elegí la **región US** (tu app está en us-east).
2. **Signing Keys**: copiá **Current** y **Next** → `QSTASH_CURRENT_SIGNING_KEY` /
   `QSTASH_NEXT_SIGNING_KEY` → Vercel.
3. **Schedules → Create Schedule:**
   - URL: `https://<tu-dominio>/api/escrow/tick`
   - Method: `POST` · Body: vacío
   - Cron: `*/3 * * * *` (cada 3 min, **entra en el free tier** de 500/día) o
     `* * * * *` (cada 1 min, mejor UX pero **excede** el free → QStash pago).

## 5. Lightning — Alby Hub (NWC)
Solo si vas a mover plata (compras y/o apuestas).
1. [hub.getalby.com](https://hub.getalby.com) → creá/abrí tu wallet (sin hardware).
2. Creá una **conexión NWC** con permisos: *make invoice, lookup invoice, pay invoice,
   get balance*. **Ponele un budget/límite de gasto** (red de seguridad).
3. Copiá el string `nostr+walletconnect://…` → `NWC_CONNECTION_STRING` → Vercel.
4. **Apuestas:** generá la identidad Nostr de Luna Negra (firma el contrato):
   ```bash
   node -e "const {generateSecretKey,nip19}=require('nostr-tools'); console.log(nip19.nsecEncode(generateSecretKey()))"
   ```
   → `LUNA_NEGRA_NSEC`.

## 6. Secretos de auth / admin
1. `JWT_SECRET` (obligatorio en prod; la app no arranca sin él):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. `ADMIN_PUBKEY` = tu pubkey en **hex** (no el `npub`). Convertilo:
   ```bash
   node --input-type=module -e "import {nip19} from 'nostr-tools'; console.log(nip19.decode('npub1TUYO').data)"
   ```

## 7. Config de apuestas (opcional)
`BET_MIN_SATS` (5), `BET_MAX_SATS` (100), `BET_FEE_PCT` (5). Si no las ponés, usa esos defaults.

---

## 8. Deployar en Vercel
1. Subí el repo a GitHub.
2. Vercel → **Add New → Project** → importá el repo (detecta Next.js).
3. Cargá **todas** las env vars de los pasos anteriores (Production).
4. El build ya está configurado en `vercel.json`: `prisma generate && next build`
   (el build **no** toca la DB, así que no falla por la base).
5. **Deploy.**

## 9. Crear las tablas (migraciones)
El build **no** corre migraciones. Una sola vez, con las URLs de prod en tu `.env` local:
```bash
npx prisma migrate deploy     # crea/actualiza todas las tablas (store + apuestas)
npm run db:seed               # opcional: juegos de ejemplo
```
> Esto aplica TODAS las migraciones pendientes (incluidas las de apuestas, `lud16`, etc.).
> Cuando cambies el schema en el futuro, repetís `prisma migrate deploy` contra prod.

## 10. Dominio propio (opcional)
Vercel → **Settings → Domains → Add** → seguí los pasos de DNS. El HTTPS lo emite Vercel solo.

---

## 11. Verificación post-deploy
- [ ] La home carga y muestra juegos (si corriste el seed).
- [ ] **Login** con Nostr (nos2x/Alby) funciona.
- [ ] **Subir imagen** en `/provider` → 200 (si activaste Blob público).
- [ ] `/admin` te deja entrar (si `ADMIN_PUBKEY` = tu pubkey hex) y a otros no.
- [ ] **Apuestas:** en los logs de Vercel ves `POST /api/escrow/tick → 200` (QStash andando).
- [ ] **Compra/apuesta real** con sats chicos: el pago entra y el cobro sale.

## 12. Checklist de seguridad
- [ ] `JWT_SECRET` fuerte y único.
- [ ] `ADMIN_PUBKEY` seteado.
- [ ] **Budget cap** puesto en el NWC de Alby Hub.
- [ ] Secretos solo en env de Vercel; `.env` **nunca** se commitea (ya gitignoreado).
- [ ] Recordá los **gates** antes de abrir las apuestas a desconocidos: oráculo de
      proveedores terceros + lo legal (ver `docs/review/`).

---

## Notas / gotchas aprendidos
- **El retiro por QR (LNURL-withdraw)** y cualquier callback de wallet externa **solo
  funciona con URL pública** → no se prueba desde `localhost`. El cobro por **lud16**
  (Lightning Address en el perfil) sí, porque el pago **sale** del Alby Hub.
- El **store de Blob debe ser PÚBLICO** (no private).
- Cambiar una env var **requiere Redeploy** para tomar efecto.
