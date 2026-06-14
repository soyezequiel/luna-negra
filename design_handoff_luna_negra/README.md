# Handoff: Rediseño Luna Negra — "Eclipse"

## Overview
Rediseño visual completo de **Luna Negra**, una tienda web de juegos PC con identidad **Nostr** + pagos **Lightning** y un fuerte componente **social** (amigos, presencia, salas, duelos con apuestas en sats). El objetivo es alejar el producto del look tipo Steam hacia una marca propia, **social-first**, cinematográfica y premium, lista para mercado.

El rediseño cubre todas las pantallas: **Tienda/Home, Ficha de juego, Biblioteca, Panel de proveedor, Apuestas, Perfil**, más el **navbar global**, la **barra de amigos / chat** (drawer en móvil) y un **modal de factura Lightning**. Todo es responsive (desktop ≥880px y móvil <880px con tab bar inferior + drawer).

## About the Design Files
Los archivos en `reference/` son **referencias de diseño creadas en HTML** — prototipos que muestran el aspecto y comportamiento buscados, **no código de producción para copiar tal cual**. El HTML usa estilos inline y una mini-capa de plantillas propia; **no lo lleves literal**.

La tarea es **recrear estos diseños en el codebase real de Luna Negra** (Next.js App Router + TypeScript + **Tailwind**), respetando sus patrones: Server/Client Components, el helper `cn()`, el `button.tsx` existente, el modelo Prisma y la estructura `src/app` / `src/components`. Donde el diseño define un color/medida exacto, usalo; donde haya un componente equivalente en el repo, reusalo.

> Stack destino confirmado: **Tailwind (clases utilitarias)**. Ver `reference/tailwind.theme.ts` para el `theme.extend` listo para pegar, y `reference/luna-negra-tokens.css` para las variables `:root` equivalentes.

## Fidelity
**Alta fidelidad (hi-fi).** Colores, tipografía, espaciados, radios, sombras, estados hover/active/focus e interacciones están definidos con valores finales. Recreá la UI de forma fiel usando las utilidades de Tailwind del repo. Las imágenes de portada son **placeholders generados por CSS** (gradientes derivados de un `hue`): en producción reemplazalas por las portadas reales que ya entrega tu modelo de datos.

---

## Design Tokens

### Color
| Token | Hex | Uso |
|---|---|---|
| `ln-bg` | `#08070c` | Fondo base de la app |
| `ln-bg-deep` | `#050409` | Inputs, fondos hundidos |
| `ln-panel` | `#110f18` | Paneles, navbar |
| `ln-card` | `#181522` | Tarjetas (a menudo con alpha, `rgba(24,21,34,.6)`) |
| **`ln-luna`** | `#9d8cff` | **Acción primaria, navegación, identidad** |
| `ln-luna-bright` | `#c2b5ff` | Gradiente/hover de Luna |
| `ln-luna-deep` | `#7d6cf0` | Burbujas de chat propias |
| **`ln-corona`** | `#ffb648` | **Dinero: sats, Lightning, comprar, apostar** |
| `ln-corona-bright` | `#ffcd7a` | Texto de precio/monto |
| **`ln-aurora`** | `#4fe6a8` | **Jugar, online/in-game, social, éxito** |
| `ln-aurora-bright` | `#84f3c6` | Texto/acento aurora |
| `ln-danger` | `#e8907a` | Expirado / perdido / cancelar |
| `ln-text` | `#e9e6f2` | Texto principal |
| `ln-soft` | `#cfc8de` | Texto secundario |
| `ln-muted` | `#9a93ad` | Descripciones, metadatos |
| `ln-faint` | `#5f5872` | Labels, placeholders, hints |

**Texto sobre fondos de marca (contraste):** sobre Luna → `#1a1430`; sobre Corona → `#231304`; sobre Aurora → `#062414`.

**Gradientes:** Luna `linear-gradient(120deg,#c2b5ff,#9d8cff)` · Corona `linear-gradient(120deg,#ffcd7a,#ffb648)` · Aurora `linear-gradient(120deg,#84f3c6,#4fe6a8)`.

**Fondo eclipse** (en un wrapper `fixed inset-0 -z-0`):
```
radial-gradient(1100px 760px at 82% -12%, rgba(157,140,255,.16), transparent 58%),
radial-gradient(820px 620px at 88% 4%, rgba(255,182,72,.10), transparent 60%),
radial-gradient(900px 900px at 8% 108%, rgba(79,230,168,.06), transparent 60%),
#08070c
```
Más una "corona" decorativa: un círculo `520px` arriba-derecha con `radial-gradient(circle at 50% 50%, transparent 52%, rgba(255,182,72,.22) 56%, rgba(157,140,255,.12) 62%, transparent 72%)` animado con `ln-corona` (pulso suave).

### Tipografía
- **Display** (títulos, números grandes): `"Bricolage Grotesque"`, weights 700–800, `letter-spacing:-.02em`. H1 hero 62px (móvil 38px); H1 de sección 32–40px; H2 17–21px.
- **UI / cuerpo**: `"Geist"`, weights 300–700. Cuerpo 13–15px, `line-height` 1.6–1.75.
- **Mono** (sats, npub, labels uppercase, bolt11): `"Geist Mono"`. Labels: 9.5–11px, `letter-spacing:.12–.22em`, `text-transform:uppercase`, color `ln-faint`.
- Cargá las 3 desde Google Fonts (Bricolage Grotesque, Geist, Geist Mono).

### Espaciado, radios, sombras
- Contenedor centrado `max-width:1240px`, padding lateral `22px`.
- Radios: sm `9px`, md `13px`, lg `18px`, xl `22px`, pill `999px`.
- Gaps de grilla típicos: cards 18px; secciones `margin-top` 26–42px.
- Sombras: card `0 22px 48px -22px rgba(157,140,255,.55)`; modal `0 40px 100px -30px rgba(0,0,0,.95)`; glows de botón = `0 14px 36px -12px <color>`.

### Portadas generadas (placeholder)
Cada juego tiene un `hue` (0–360). La portada es una capa `absolute inset-0`:
```
repeating-linear-gradient(135deg, rgba(255,255,255,.045) 0 2px, transparent 2px 16px),
radial-gradient(130% 100% at 20% 8%, hsl(H 70% 34% / .95), transparent 60%),
radial-gradient(130% 120% at 85% 95%, hsl(H+50 78% 26% / .95), transparent 65%),
linear-gradient(160deg, hsl(H 52% 22%), hsl(H+28 58% 11%))
```
Avatares: `linear-gradient(135deg, hsl(H 58% 50%), hsl(H+40 62% 32%))`, círculo con iniciales. **En producción**: portada real si existe, este gradiente como fallback.

---

## Screens / Views

### Shell global (en todas las pantallas)
- **Navbar** sticky (`top:0`, `h:66px`, `z:50`), `backdrop-blur`, fondo `linear-gradient(180deg, rgba(17,15,24,.92), rgba(8,7,12,.82))`, borde inferior hairline.
  - Izquierda: **logo eclipse** (disco `#0a0810` 26px con `box-shadow` de corona dorada) + wordmark "Luna **Negra**" (Negra en `ln-corona`).
  - Centro (≥880px): links **Tienda · Biblioteca · Apuestas · Amigos · Proveedor**. Activo: fondo `rgba(157,140,255,.14)` + borde interior + subrayado dorado 16×2px. Hover: `color #fff; bg rgba(255,255,255,.05)`.
  - Derecha: buscador pill (≥880px; expande de 180→212px en focus, ring `rgba(157,140,255,.16)`), **pill de saldo** `⚡ 42 480` (corona), **avatar** circular (gradiente violeta, abre Perfil).
  - **Móvil (<880px)**: se ocultan links y buscador; el buscador pasa al tope del Home como campo full-width.
- **Layout**: flex de dos columnas — `main` (flex:1) + **aside de amigos** 308px a la derecha (sticky en desktop, drawer en móvil).
- **Footer**: logo + tagline "Jugá en el navegador. Pagá con Lightning. Conectá con Nostr." + links Términos/Privacidad/Desarrolladores/© 2026.
- **Tab bar inferior (solo móvil)**: fija abajo, 5 ítems con ícono + label (Tienda ◎, Biblioteca ▦, Apuestas ◆, Amigos ◉, Proveedor ▲). Activo en corona; "Amigos" abre el drawer. Dejá un spacer de 76px al final del `main` para que no tape contenido.

### 1) Tienda / Home
- **(Móvil) Buscador** full-width 46px arriba.
- **Hero cinematográfico**: card `radius:22px`, `min-height:430px` (móvil 350px). Capa de portada del juego destacado + overlay `linear-gradient(95deg, rgba(8,7,12,.96) 8%, …, transparent)` para legibilidad, + "corona" animada arriba-derecha. Contenido abajo-izquierda: badge mono "★ DESTACADO" + dot online aurora "1 240 jugando ahora"; **H1 62px**; descripción (máx 480px); chips de tags; botón **"▶ Ver juego"** (pill, gradiente Luna, glow, hover `translateY(-2px)`); precio en mono corona + "· Web · Lightning".
- **Riel social "Tus amigos están jugando"**: header con dot aurora + link "Ver todos ›". Fila scroll-x de cards 182px: avatar con dot de presencia aurora, nombre, "jugando ahora", y mini-fila con portada 26px + nombre del juego. Hover: borde aurora + `translateY(-3px)`.
- **Chips de categoría**: Todas, Acción, Aventura, Puzzle, Estrategia, Arcade, Casino, Multijugador. Activo: gradiente Luna + texto oscuro. Inactivo: `bg rgba(24,21,34,.6)`, borde hairline.
- **Catálogo**: header "Catálogo" + conteo en mono. Grid `repeat(auto-fill,minmax(214px,1fr))`, gap 18px. Cards verticales 3:4: portada, badge de categoría arriba-izq, badge "⚇ Multi" (aurora) arriba-der si aplica, gradiente inferior. Hover: `translateY(-5px)` + borde luna + sombra. Debajo: título + precio (corona si pago, aurora "Gratis" si 0).
- **Skeletons**: mientras carga (~850ms), grid de placeholders con **shimmer** (`ln-shimmer`) + barras de título/subtítulo. Reemplazar por estado de carga real de tus fetches.

### 2) Ficha de juego
- Breadcrumb "← Tienda". Encabezado: **H1 40px** + chip de categoría + dot aurora "1 240 en línea".
- **Grid `1fr / 340px`** (móvil: 1 columna, la tarjeta de compra va **primero** vía `order:-1`).
- Izquierda: **galería** (imagen principal 16:9 con label mono) + 4 miniaturas 16:10 (hover borde luna); **"Acerca del juego"** (párrafo + lista de features en 2 col); **"Reseñas de la comunidad"** (cards con avatar, nombre, estrellas corona, texto).
- Derecha sticky (`top:86px`): **tarjeta de compra** (borde corona, glow) con precio mono grande + **"⚡ Comprar con Lightning"** (gradiente corona) + "+ Agregar a deseados"; **panel social** (borde aurora) "Jugá con amigos" con avatares apilados + "Crear sala e invitar" (gradiente aurora); **metadatos** (Proveedor, Modos, Lanzamiento, Plataforma).
- **Relacionados**: grid de cards 3:4 de la misma categoría.

### 3) Biblioteca
- H1 "Tu biblioteca" + conteo.
- **"Seguir jugando"**: grid 3 col (móvil 1), cards 16:9 con overlay inferior, título (hasta 2 líneas), "Jugaste hace 2 h" y botón **"▶ Jugar"** (aurora).
- **"Todos tus juegos"**: grid `auto-fill minmax(200px,1fr)`, cards 16:10 + título + botones "▶ Jugar" (aurora) / "Ver".

### 4) Panel de proveedor (max-width 920px centrado)
- Header + botón "Abrir guía /dev".
- **KPIs** (grid 4 / móvil 2): card con barra de color a la izquierda, label mono, valor display 27px, sub. (Ingresos pagados, Pendiente, Juegos publicados, Ventas.)
- **"Nuevo juego"**: form — input título, textarea descripción, grid 2 (Precio sats en mono corona / Categoría select-look), 2 dropzones dashed (Portada vertical / horizontal), botón "Crear borrador" (Luna).
- **"Tus juegos"**: filas con mini-portada, título, precio, badge de estado (Publicado=aurora, En revisión=corona, Borrador=gris), botón Editar.
- **"Ventas recientes"**: tabla simple título + monto mono corona + estado.

### 5) Apuestas  ⚠️ (modelo escrow real — ver más abajo)
- Header + descripción del escrow + badge "Escrow Lightning activo".
- **KPIs** (3): En juego ahora (sats en escrow), Ganadas (x/y + % efectividad), Duelos activos.
- **"Duelos activos"**: grid 2 col (móvil 1). Cada card:
  - Cabecera con portada del juego + nombre + **badge de estado** (ver enum).
  - **VS**: avatar propio "VN" + "Vos" / "VS" / avatar rival + nombre.
  - **Pozo**: "Tu stake" (mono) + "Premio al ganador" (= pozo − comisión 4%, en corona, destacado).
  - **Condición de victoria** (texto).
  - **Progreso de depósitos**: "x/y depósitos" + comisión "N sats · 4%" + barra (corona si esperando, aurora si financiado) + deadline "Vence en N min".
  - **CTA contextual**: `pending_deposits` → **"⚡ Depositar N sats"** (corona) que **abre el modal de factura**; `funded` → **"▶ Entrar a la sala"** (aurora). Secundario: "Cancelar y reembolsar".
  - Card extra "**+ Crear un duelo**" (dashed luna).
- **Historial**: filas con portada, juego, "vs Rival · stake", resultado (Ganada=aurora / Perdida=danger / Reembolso=gris) y payout mono.

### 6) Perfil
- **Cabecera**: card con fondo radial luna/corona, avatar 96px (ring luna + glow), **H1 nombre**, chip mono **npub** (`⬡ npub1…`), "Miembro desde…", pills **saldo Lightning** (corona) y **Ranking #N** (aurora), botones "Editar perfil" (Luna) / "Compartir".
- **Stats** (4 / móvil 2): Victorias, Saldo Lightning, Juegos, Amigos (mismo patrón KPI con barra de color).
- **2 columnas** (móvil 1): **"Actividad reciente"** (filas texto + meta mono coloreada + cuándo) y **"Ranking de victorias"** (filas con rank coloreado oro/plata/bronce, avatar, nombre + victorias apiladas, badge **VOS** en tu fila resaltada en luna).
- **"Tu biblioteca"**: grid de cards 3:4 (4 / móvil 2).

### Barra de amigos / chat (aside derecho, drawer en móvil)
- **Lista**: header "Amigos" + conteo online (dot aurora), botón refrescar; (móvil) botón ✕ para cerrar drawer. Buscador "Buscar o agregar por npub…". Filas: avatar con **dot de presencia** (aurora online / gris offline), nombre + badge **LN** (corona) si tiene Lightning, línea de presencia (verde "🎮 Juego" in-game / "En línea" / gris "Visto hace…"), chevron. Hover: `bg rgba(255,255,255,.04)`. En la **ficha de juego** aparece además botón "⚇ Invitar a jugar" por amigo (→ toast "Invitación enviada", cambia a "✓ Invitado").
- **Chat** (al tocar un amigo): header con back ‹, avatar+presencia; burbujas (propias gradiente luna `#9d8cff→#7d6cf0` alineadas a la derecha / ajenas `rgba(255,255,255,.06)` izquierda); bloque "Invitalo a jugar" (aurora) + input pill + botón enviar ➤.
- **Móvil**: el aside es un **drawer** `fixed right-0 w:min(360px,88vw)`, entra con `translateX` (transición `.28s`), con **overlay** oscuro que cierra al tocar. Se abre desde la tab "Amigos".

### Modal de factura Lightning (al tocar "Depositar")
- Overlay `fixed inset-0 z-92`, fondo `rgba(3,2,6,.74)` + blur, centra una card 362px (borde corona, sombra modal). Cierra al tocar fuera o ✕.
- Contenido: header (⚡ "Depósito de apuesta" + "Juego · vs Rival"); "Pagá exactamente" + **monto display** corona; **QR** sobre card blanca (200px) con logo ⚡ al centro; indicador **"Esperando el pago"** con dot `ln-ping` + expiración; fila **bolt11** (mono truncado `lnbc…` + botón "Copiar" → `navigator.clipboard` + toast); botones **"⚡ Abrir en wallet"** (corona, abre `lightning:` URI / tu wallet) y **"Ya pagué — confirmar"** (aurora, confirma depósito); nota de escrow/reembolso.
- En el prototipo el QR es un patrón generado (placeholder con patrones de localización). **En producción**: generá el QR real del `bolt11` que devuelva tu backend (`qrcode` o similar).

### Toasts
- Confirmaciones efímeras (`fixed`, ~2.6s, entra con `ln-toast`/translate+fade): icono ✓ aurora + mensaje. Posición: desktop abajo-derecha (sobre el aside); móvil abajo full-width sobre la tab bar.

---

## Interactions & Behavior
- **Navegación SPA** entre pantallas (en producción: rutas del App Router — `/`, `/game/[slug]`, `/library`, `/provider`, `/bets`, `/profile`). El prototipo cambia una variable `screen`; mapealo a rutas reales. Al navegar, `scrollTo({top:0, behavior:"smooth"})`.
- **Hover** en cards: `translateY(-3…-5px)` + borde de color + sombra (transición `.16s ease`).
- **Skeletons**: mostrar mientras cargan los datos; quitar al resolver.
- **Animaciones de entrada**: secciones con `ln-rise` (translateY 16→0; **sin** opacidad 0 en exports/PDF). Corona del eclipse/hero con `ln-corona` (pulso). Shimmer en skeletons. Ping en "esperando pago".
- **Invitar a jugar / a sala**: marca al amigo como invitado + toast.
- **Copiar bolt11**: `navigator.clipboard.writeText` + toast.
- **Responsive**: breakpoint único en **880px**. <880: navbar condensado, buscador al tope, grids colapsan (ficha 1 col con compra primero; KPIs 4→2; galería 4→2; biblioteca/keep-playing 1 col; perfil cols 1; apuestas 1 col), barra de amigos → drawer + overlay, tab bar inferior, toast full-width. Recalcular en `resize`.

## State Management
Variables del prototipo (traducir a estado/rutas/queries reales):
- `screen` → **rutas** del App Router.
- `slug` (juego abierto) → param de ruta `/game/[slug]`.
- `cat`, `q` → filtros de catálogo (categoría + búsqueda; en server: searchParams).
- `loaded` → estado de carga real de los fetches (mostrar skeletons mientras).
- `invited{}` → set de amigos invitados (optimista; POST a tu API de invites/`/api/v1/invites`).
- `chatPk` → conversación abierta en la barra de amigos.
- `drawer` (móvil) → apertura del drawer de amigos.
- `invoiceBet` → apuesta cuya factura está abierta en el modal.
- `toast` → mensaje efímero.

## Modelo de datos real (NO inventar — alinear con el backend)
El rediseño de **Apuestas** y la **factura** siguen el modelo real del game server (escrow vía Luna Negra). Respetá estos contratos:
- **Apuesta atada a una sala** con: `stakeSats`, `potSats`, `potTargetSats`, `feeSats`, `feePct`, `netPayoutSats`, `victoryCondition` (texto, default "Último jugador en pie gana el pozo."), `depositDeadline`, `depositsReceived`/`depositsTotal`, `participants[]` (cada uno con `depositStatus: pending|paid|refunded|failed`, `bolt11`, `lnurl`, `payUrl`, `payoutSats`), `winnerNpubs`.
- **Estados de apuesta** (`RoomBetStatus`): `pending_deposits` · `funded` · `settled` · `cancelled` · `expired` · `refunded`. Mapeo de color: pending→corona, funded→aurora, settled→luna, cancelled/refunded→gris, expired→danger.
- **Acciones** (endpoints reales): `create` / `refresh` / `cancel` / `settle` (`/api/v1/bets/*` con escrow Lightning) — la comisión por defecto es **4%**.
- **Capa social**: `GET /session` (SSO por `lnToken`), `GET /friends?presence=true` (presencia `in-game|online|offline` + `roomId`), `POST /presence` (heartbeat ~10s, TTL 20s), `POST /invites` / `GET /invites`. La presencia "🎮 jugando" y los dots de la barra de amigos vienen de acá.
- **Perfil / ranking**: `wins` y orden del leaderboard salen de `GET /leaderboard` (`LeaderboardEntry`: `playerId, npub, name, avatarUrl, wins, createdAtServerMs`). Identidad = **npub** Nostr.

## Assets
- **Ninguna imagen externa.** Portadas y avatares son gradientes generados por CSS (fallback). Reemplazá por las imágenes reales de tu modelo (`coverUrl`, `avatarUrl`) cuando existan.
- **Fuentes**: Google Fonts — Bricolage Grotesque, Geist, Geist Mono.
- **Íconos**: glyphs Unicode (⚡ ▶ ⚇ ✓ ◎ ▦ ◆ ◉ ▲ ⬡ ★). Podés sustituir por tu set de íconos (p. ej. lucide) manteniendo el significado.

## Files (en `reference/`)
- `Luna Negra.dc.html` — prototipo navegable completo (todas las pantallas + interacciones). Abrilo en el navegador para ver comportamiento, hover y responsive (cambiá el ancho de ventana).
- `luna-negra-tokens.css` — bloque `:root` con todos los tokens + guía de uso.
- `tailwind.theme.ts` — `theme.extend` listo para pegar en `tailwind.config.ts` (colores `ln-*`, fuentes `font-display/sans/mono`, radios, gradientes `bg-ln-*`, sombras, keyframes/animaciones).

## Recomendación de implementación
1. Pegá `tailwind.theme.ts` en tu config y cargá las 3 fuentes.
2. Empezá por el **shell** (layout + navbar + aside de amigos + tab bar móvil) ya que envuelve todo.
3. Seguí por **Home** (hero, riel social, chips, catálogo, skeletons), luego **Ficha**, **Biblioteca**, **Proveedor**.
4. Implementá **Apuestas** + **modal de factura** conectando los endpoints reales (`/api/v1/bets/*`, QR real del `bolt11`).
5. **Perfil** con `leaderboard` + datos de sesión Nostr.
6. Conectá presencia/invitaciones de la capa social a la barra de amigos.
