# Luna Negra 🌑

Una tienda de juegos para jugar **desde el navegador**, sin instalar nada, donde pagás
y cobrás en **Bitcoin** (sats) por la red **Lightning**. Pensada para que un argentino
pueda comprar un juego, dejarle una propina a quien lo hizo o apostar una partida con
un amigo **sin tarjeta, sin banco y sin pasar por el dólar**.

> Demo en vivo: **[luna.naranja.fit](https://luna.naranja.fit)**

---

## ¿Qué es, en criollo?

Es como una mini-Steam, pero:

- **Se juega en el navegador.** Entrás, abrís el juego y listo. No hay descargas.
- **La plata son sats** (la unidad chica de Bitcoin). Pagás escaneando un QR con
  cualquier billetera Lightning. Una compra se confirma en segundos.
- **No hay intermediario financiero.** No cargás tarjeta ni datos bancarios. La plata
  va de tu billetera a la del desarrollador.
- **Tu identidad es tuya.** El login usa **Nostr**, un sistema abierto donde la cuenta
  es una clave que controlás vos, no un mail y una contraseña en un servidor ajeno.
  (Igual, si todo esto te suena chino, también podés entrar con tu email; ver abajo.)

### ¿Por qué puede interesarte si estás en Argentina?

- Comprás y cobrás en **Bitcoin** sin depender del homebanking ni de límites de tarjeta.
- Un desarrollador local puede **vender su juego al mundo** y recibir sats al instante,
  sin esperar liquidaciones ni pagar comisiones de pasarelas tradicionales.
- Todo se mueve en **sats/BTC**: nada se convierte a pesos ni a dólares dentro de la app.

---

## Qué podés hacer

**Como jugador:**
- Navegar la tienda, ver reseñas y **comprar juegos pagando un QR Lightning**.
- Tener tu **biblioteca** y jugar lo que compraste cuando quieras.
- A los juegos **gratis**, dejarle una **propina** directa al desarrollador.
- Sumar **amigos**, **chatear** y ver a quién está **jugando ahora** (todo sobre Nostr).
- Apostar una partida: la app **custodia el pozo** y le paga al ganador.

**Como desarrollador de juegos:**
- Publicar tu juego (con una revisión simple antes de salir).
- **Cobrar en sats**: de cada venta recibís el **70%** automáticamente en tu billetera.
- Usar las APIs de Luna Negra para login, control de compra, salas multijugador,
  invitaciones y marcadores, sin tener que armar todo eso vos. Ver
  **[guía de integración](docs/api-publica.md)** y el **[SDK](sdk/)**.

---

## Cómo entrás (3 formas)

1. **Con una extensión Nostr** en el navegador — la opción para gente técnica
   ([nos2x](https://github.com/fiatjaf/nos2x) o [Alby](https://getalby.com/)).
2. **Con el celu, escaneando un QR** — usás una app firmadora de Nostr
   (Amber, Primal, etc.) y aprobás el ingreso desde el teléfono.
3. **Con tu email** — te llega un link mágico y listo. Luna Negra te crea y te
   guarda la identidad Nostr por detrás; después podés exportarla cuando quieras.

---

## Levantarlo vos mismo

Hay dos caminos. Si solo querés **verlo funcionando**, andá por Docker.

### Opción A — Todo con Docker (la más fácil, y la que usa producción)

Levanta la tienda **y la base de datos** en contenedores, y la podés exponer a
internet con **Cloudflare Tunnel** (sin IP pública ni abrir puertos).

```bash
cp .env.docker.example .env.docker     # completá al menos JWT_SECRET
docker compose --env-file .env.docker up -d --build
docker compose logs -f app
```

Queda en `http://localhost:3000`. Para servirla en tu dominio con HTTPS, seguí el
**[tutorial de self-hosting](docker/TUTORIAL.md)** (de cero a online) o la
**[referencia corta](docker/README.md)**.

### Opción B — Desarrollo local (npm)

Para tocar el código con recarga en caliente. Necesitás **Node 20+** y un **Postgres**
(lo más simple es levantar solo el Postgres del compose de arriba).

```bash
npm install
cp .env.example .env        # completá DATABASE_URL / DIRECT_URL y JWT_SECRET
npx prisma migrate deploy   # crea las tablas
npm run db:seed             # (opcional) datos de ejemplo
npm run dev
```

Abrí http://localhost:3000.

### Scripts útiles
- `npm run dev` — servidor de desarrollo.
- `npm run build` — build de producción.
- `npm test` — tests (Vitest).
- `npx prisma studio` — explorar la base de datos.

---

## Cómo está hecho

- **Web + API:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4.
- **Identidad:** Nostr — login firmando un desafío (NIP-07 / NIP-46) o email custodial.
- **Pagos:** Lightning vía NWC (Alby Hub). Compras con reparto 70/30; propinas y
  apuestas en sats. Nada sale a moneda fiat.
- **Social** (amigos, chat, presencia, actividad): vive en **relays Nostr** públicos,
  no en la base de datos.
- **Base de datos:** Postgres (Prisma).
- **Producción:** la app y el Postgres corren en **Docker**, publicados con
  **Cloudflare Tunnel**.

---

## Más documentación

- **[PLAN.md](PLAN.md)** — visión, alcance y modelo de negocio del MVP.
- **[ROADMAP.md](ROADMAP.md)** — qué está hecho y qué sigue.
- **[docs/](docs/)** — API pública, apuestas/escrow, multijugador, categorías.
- **[docker/](docker/)** — self-hosting paso a paso.
</content>
</invoke>
