# Configurar Upstash QStash — el "tick" del escrow

## Qué hace
El escrow necesita que **algo dispare `/api/escrow/tick` cada ~1 min** para:
- detectar depósitos pagados → pasar la apuesta a `ready`,
- reembolsar si no se completan los depósitos (10 min) o no llega resultado (15 min),
- marcar `forfeited` los retiros no reclamados (60 min).

**QStash** es ese disparador: un *scheduler* en la nube que le pega a tu endpoint
en intervalos, firmando cada request para que solo QStash pueda dispararlo.

---

## 1. Crear QStash
1. Entrá a [console.upstash.com](https://console.upstash.com) (la misma cuenta del Redis del rate-limit).
2. En el menú, **QStash**.

## 2. Copiar las signing keys a tu entorno
1. En la página de QStash, sección **Signing Keys**, copiá:
   - **Current Signing Key** → `QSTASH_CURRENT_SIGNING_KEY`
   - **Next Signing Key** → `QSTASH_NEXT_SIGNING_KEY`
2. Pegalas en tu `.env.docker` (self-host) o en el entorno de tu host.
3. **Reiniciá/reconstruí** el contenedor para que tome las variables
   (`docker compose --env-file .env.docker up -d --build`).

> El endpoint `/api/escrow/tick` **verifica la firma de QStash** con esas claves
> (ver `src/app/api/escrow/tick/route.ts`). Sin firma válida → 401. Nadie más puede
> dispararlo.

## 3. Crear el Schedule
1. En QStash → pestaña **Schedules** → **Create Schedule**.
2. Completá:
   - **Destination (URL):** `https://luna.naranja.fit/api/escrow/tick`
     *(usá tu dominio del túnel de Cloudflare)*
   - **Method:** `POST`
   - **Body:** vacío
   - **Cron:** `* * * * *` (cada minuto) — ver costos abajo.
3. **Create**.

¡Listo! QStash empieza a pegarle a tu tick.

## 4. Frecuencia y costo (importante)
El free tier de QStash es **500 mensajes/día**. Cada minuto = **1440/día** → se pasa.
Opciones:

| Cron | Frecuencia | Mensajes/día | Free tier | Latencia de reembolsos |
|------|-----------|--------------|-----------|------------------------|
| `* * * * *` | cada 1 min | 1440 | ❌ (pagás) | mínima (mejor UX) |
| `*/3 * * * *` | cada 3 min | 480 | ✅ | hasta ~3 min |
| `*/5 * * * *` | cada 5 min | 288 | ✅ holgado | hasta ~5 min |

Para la **beta entre amigos**, `*/3` o `*/5` entra en el free tier. La contra: el
juego puede tardar hasta 3-5 min en pasar a `ready` después del último depósito.
Si querés que arranque al toque, usá `* * * * *` (pago, es barato).

## 5. Verificar que anda
- En QStash → **Schedules / Logs**: vas a ver las entregas y el **código de respuesta**
  (debería ser `200` con un JSON `{ ok: true, deposits, ready, refunded, forfeited }`).
- En los logs de la app (`docker compose logs -f app`): cada tick aparece como un
  `POST /api/escrow/tick → 200`.
- Si ves `401`: las signing keys no coinciden o falta reiniciar el contenedor.

## 6. Alternativa sin costo (cron-job.org)
Si no querés pagar y `*/3` no te alcanza, podés usar [cron-job.org](https://cron-job.org)
(gratis, 1/min) — pero **no firma como QStash**, así que habría que cambiar la
protección del endpoint a un **secreto compartido** (header `Authorization: Bearer <secreto>`).
Decímelo y lo ajusto en `route.ts`.

---

## Resumen
1. QStash → copiar signing keys → `.env.docker` (`QSTASH_CURRENT/NEXT_SIGNING_KEY`) → reiniciar.
2. Crear Schedule: POST a `/api/escrow/tick`, cron `*/3 * * * *` (free) o `* * * * *` (pago).
3. Verificar `200` en los logs de QStash y de la app.
