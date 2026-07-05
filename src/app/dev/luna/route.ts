// Guia autocontenida de la interfaz REST v1 dependiente de Luna Negra.
//
// Esta es la version VIEJA: el juego pregunta a la API central de Luna Negra
// (login SSO por lnToken, escrow, salas, marcadores, webhooks). Se esta dejando
// de usar en favor de NGP (eventos Nostr, en /dev). Vive acá, "escondida" fuera
// de /dev, con un aviso de deprecacion arriba. Sigue siendo lo unico que cubre
// escrow REST, verificacion de compra de pago y webhooks firmados.
//
// Comparte estilo y scripts con la guia NGP vía src/lib/dev-guide.ts.

import { devGuideDoc, originFrom } from "@/lib/dev-guide";

const BODY = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" aria-label="Volver a Luna Negra">
          <span class="brand-mark">LN</span>
          <span>Luna Negra</span>
        </a>
        <nav class="top-links" aria-label="Navegacion principal">
          <a href="/dev">NGP (nuevo)</a>
          <a href="#inicio">Inicio</a>
          <a href="#skill">Skill IA</a>
          <a href="#guia-manual">Guia manual</a>
          <a href="/developers">Referencia</a>
        </nav>
        <a class="top-action" href="/provider">Crear juego</a>
      </div>
    </header>

    <main id="inicio" class="shell">
      <div class="dep-banner" role="alert" style="margin-top:24px;">
        <div class="dep-text">
          <strong>Version vieja &mdash; interfaz REST v1 dependiente de Luna Negra.</strong>
          <span>
            Se esta <strong>dejando de usar</strong>. La integracion recomendada ahora
            es <strong>NGP</strong> (eventos Nostr, independiente de la API central).
            Segui esta guia solo para escrow REST, verificacion de compra de pago o
            webhooks firmados, que todavia viven aca.
          </span>
        </div>
        <a class="button primary" href="/dev">Ir a NGP (recomendado) &rarr;</a>
      </div>

      <div class="hero">
        <div>
          <span class="eyebrow">Guia para integrar juegos &middot; REST v1</span>
          <h1>Integra tu juego con la API de Luna Negra.</h1>
          <p class="lead">
            Publica, reconoce jugadores Nostr, cobra en sats y agrega salas sin
            construir la infraestructura comun desde cero.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="/provider">Crear juego</a>
            <a class="button" href="#skill">Instalar skill</a>
            <a class="button" href="/developers">Probar API</a>
          </div>
        </div>

        <aside class="flow-panel" aria-label="Flujo recomendado de integracion">
          <div class="panel-head">
            <strong>Ruta base</strong>
            <span class="status">API v1 estable</span>
          </div>
          <div class="flow">
            <div class="flow-step">
              <b>01</b>
              <div><strong>Publica el juego</strong><span>Desde <a href="/provider">/provider</a> cargas datos, precio, imagenes y la URL donde vive tu juego.</span></div>
            </div>
            <div class="flow-step">
              <b>02</b>
              <div><strong>Valida al jugador</strong><span>Canjea el <code>lnToken</code> por identidad Nostr en <code>/api/v1/session</code>.</span></div>
            </div>
            <div class="flow-step">
              <b>03</b>
              <div><strong>Suma funciones</strong><span>Activa pagos, apuestas, salas, marcadores o webhooks solo si tu juego los necesita.</span></div>
            </div>
          </div>
        </aside>
      </div>

      <div class="choice-section" aria-label="Rutas de integracion">
        <div class="choice-head">
          <span class="eyebrow">Elegi una ruta</span>
          <h2>Arranca por un solo camino.</h2>
          <p>La guia completa queda abajo como consulta. No hace falta leer todo antes de empezar.</p>
        </div>
        <div class="choice-grid">
          <a class="choice-card recommended" href="#skill">
            <span class="choice-label">Mas directo</span>
            <strong>Deja que tu agente integre la API</strong>
            <span>Instala la skill y pedi login, pagos, salas o webhooks segun lo que necesite tu juego.</span>
            <em>Ver comando &rarr;</em>
          </a>
          <a class="choice-card" href="/developers">
            <span class="choice-label">Manual</span>
            <strong>Proba la API v1 endpoint por endpoint</strong>
            <span>Usa la referencia interactiva para requests reales. El contrato completo esta en OpenAPI.</span>
            <em>Abrir /developers &rarr;</em>
          </a>
        </div>
      </div>

      <div class="content">
        <aside class="toc" aria-label="Indice de secciones">
          <strong>Indice</strong>
          <nav>
            <a href="/dev">&larr; Volver a NGP</a>
            <a href="#skill">Skill para tu IA</a>
            <a href="#guia-manual">Guia manual</a>
            <a href="#conceptos">Conceptos en simple</a>
            <a href="#sso">Identidad y SSO</a>
            <a href="#apuestas">Apuestas / escrow</a>
            <a href="#multijugador">Multijugador</a>
            <a href="#sdk">SDK TypeScript</a>
            <a class="toc-sep" href="#endpoints">Endpoints rapidos</a>
          </nav>
        </aside>

        <article class="article">
          <section id="skill">
            <h2>Integra con una skill de IA <span class="badge ok">recomendado</span></h2>
            <p class="section-lead">
              Instala el contexto de Luna Negra una vez y pedi a tu agente que conecte
              solo lo que necesitas: login, pagos, salas, marcadores o webhooks.
            </p>

            <div class="install-hero">
              <span class="step-label">Recomendado &middot; cualquier agente</span>
              <h3>Copia este comando</h3>
              <div class="cmd">
                <button type="button" class="copy-btn" aria-label="Copiar comando">Copiar</button>
                <pre><code>npx skills add soyezequiel/luna-negra</code></pre>
              </div>
              <p class="hint">
                Funciona desde cualquier carpeta, sin clonar nada. El CLI
                <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noopener">CLI <code>skills</code></a>
                deja el <code>SKILL.md</code> en la carpeta de skills de tu agente.
                Despues reinicialo y pedi: <em>&ldquo;integra mi juego con Luna Negra&rdquo;</em>.
              </p>
              <p class="hint">
                Para saltear la telemetria del CLI:
                <code>DISABLE_TELEMETRY=1 npx skills add soyezequiel/luna-negra</code>.
              </p>
            </div>

            <p class="note">
              <strong>Empieza chico.</strong> El minimo util es login SSO. Presencia,
              salas, apuestas, marcadores y webhooks se suman solo si los pedis.
            </p>

            <details class="alt-install">
              <summary>Otras formas de instalarla</summary>
              <p>
                Si no queres usar <code>npx</code>, podes instalar directo en Claude
                Code o descargar el Markdown autocontenido para pasarlo como contexto.
              </p>
              <div class="card-grid">
                <div class="mini-card info">
                  <strong>Instalador directo (Claude Code)</strong>
                  <div class="cmd" style="margin-top:8px;">
                    <button type="button" class="copy-btn" aria-label="Copiar comando PowerShell">Copiar</button>
                    <pre><code>iwr -useb "__LUNA_NEGRA_BASE__/dev/install?version=1.0&amp;ps" | iex</code></pre>
                  </div>
                  <div class="cmd" style="margin-top:8px;">
                    <button type="button" class="copy-btn" aria-label="Copiar comando bash">Copiar</button>
                    <pre><code>curl -fsSL "__LUNA_NEGRA_BASE__/dev/install?version=1.0" | sh</code></pre>
                  </div>
                  <span>PowerShell (Windows) o bash (macOS/Linux). Deja el <code>SKILL.md</code> ya configurado con la URL de este deploy.</span>
                </div>
                <div class="mini-card ok">
                  <strong>Descargar o pasar por URL</strong>
                  <p style="margin:6px 0 0;"><a class="button" href="/dev/skill?version=1.0" download="SKILL.md">Descargar SKILL.md</a></p>
                  <div class="cmd" style="margin-top:8px;">
                    <button type="button" class="copy-btn" aria-label="Copiar URL">Copiar</button>
                    <pre><code>__LUNA_NEGRA_BASE__/dev/skill?version=1.0</code></pre>
                  </div>
                  <span>Guardalo como <code>AGENTS.md</code> en la raiz del repo, o pasale esa URL al agente y pedile que la lea.</span>
                </div>
              </div>
            </details>
          </section>

          <details class="manual" id="guia-manual">
            <summary class="manual-summary">
              <span class="manual-summary-text">
                <span class="manual-summary-main">Guia manual de API v1</span>
                <span class="manual-summary-sub">Login, pagos, salas, marcadores, webhooks y SDK. Abri solo la parte que necesites.</span>
              </span>
            </summary>

          <section id="conceptos">
            <h2>1. Conceptos en simple</h2>
            <p class="section-lead">
              Luna Negra funciona como una capa de tienda, identidad, pagos y social
              alrededor de tu juego. Tu juego sigue siendo tuyo; la plataforma resuelve
              las partes comunes para que no las tengas que construir desde cero.
            </p>

            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Concepto</th><th>En simple</th><th>Para developers</th></tr>
                </thead>
                <tbody>
                  <tr><td>Proveedor</td><td>Tu estudio o equipo dentro de Luna Negra.</td><td>El owner que crea juegos, API keys, webhooks y recibe payouts.</td></tr>
                  <tr><td>Juego</td><td>La experiencia que publica tu equipo.</td><td>Entidad con <code>gameId</code>, precio, URL, assets y estado de publicacion.</td></tr>
                  <tr><td>Jugador</td><td>La persona que compra o entra a jugar.</td><td>Identidad Nostr estable: <code>npub</code> y <code>pubkey</code>.</td></tr>
                  <tr><td>Pase temporal</td><td>La prueba de que el jugador puede abrir el juego.</td><td>JWT <code>lnToken</code> con scope de entitlement.</td></tr>
                  <tr><td>API key</td><td>La llave privada de tu servidor para hablar con Luna Negra.</td><td><code>ln_sk_...</code>; nunca debe ir al navegador.</td></tr>
                  <tr><td>Webhook</td><td>Un aviso automatico cuando pasa algo importante.</td><td>POST firmado con HMAC a la URL de tu backend.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="credenciales">
            <h2>2. Credenciales y reglas base</h2>
            <p class="section-lead">
              Hay tres credenciales principales. La API key vive solo en tu servidor;
              los JWT de jugador son cortos y se validan con JWKS o endpoints de verify.
            </p>

            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>Cada credencial responde una pregunta: quien es el jugador, si puede entrar, o si tu servidor tiene permiso para operar.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>Todas viajan como <code>Authorization: Bearer ...</code>. La API key es secreta; los JWT se pueden validar con JWKS.</span>
              </div>
            </div>

            <div class="card-grid">
              <div class="mini-card money">
                <strong><span class="badge money">API key</span> <code>ln_sk_...</code></strong>
                <span>Server-to-server: crear apuestas, presencia global, amigos, invitaciones, webhooks y actividad.</span>
              </div>
              <div class="mini-card info">
                <strong><span class="badge">entitlement</span> <code>lnToken</code></strong>
                <span>Login SSO y marcador. Viene en la URL al abrir el juego y expira rapido.</span>
              </div>
              <div class="mini-card ok">
                <strong><span class="badge ok">invite</span> token de sala</strong>
                <span>Permite entrar a una sala, reportar presencia y leer/escribir estado compartido.</span>
              </div>
            </div>

            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Aspecto</th><th>Convencion publica</th></tr>
                </thead>
                <tbody>
                  <tr><td>Auth</td><td>Siempre <code>Authorization: Bearer &lt;token-o-api-key&gt;</code>.</td></tr>
                  <tr><td>Dinero</td><td>Todo lo publico esta expresado en <strong>sats</strong>.</td></tr>
                  <tr><td>Errores</td><td><code>{ "error": { "code", "message" } }</code> con status HTTP correcto.</td></tr>
                  <tr><td>Exito</td><td>El cuerpo es el objeto crudo, sin envelope <code>{ data }</code>.</td></tr>
                  <tr><td>CORS</td><td>Abierto para los endpoints publicos donde corresponde llamar desde el juego.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="sso">
            <h2>3. Identidad y login SSO</h2>
            <p class="section-lead">
              Tu juego se abre con <code>?lnToken=&lt;jwt&gt;</code>. Canjealo al cargar,
              guarda la identidad del jugador y descarta el token cuando ya no lo necesites.
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>El jugador no crea otra cuenta. Luna Negra le entrega a tu juego un pase temporal que confirma quien es y que puede jugar.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>El pase llega como <code>lnToken</code>. Tu app llama a <code>/api/v1/session</code> y obtiene <code>npub</code>, <code>pubkey</code> y perfil.</span>
              </div>
            </div>
            <div class="two-col">
              <pre><code>const r = await fetch("https://&lt;LUNA_NEGRA&gt;/api/v1/session", {
  headers: { authorization: "Bearer " + lnToken },
});

const {
  npub,
  pubkey,
  displayName,
  avatarUrl,
  gameId,
} = await r.json();</code></pre>
              <div class="mini-card info">
                <strong>Usa <code>npub</code> como player id</strong>
                <span>Es la identidad estable del jugador. No generes UUIDs locales si despues queres presencia, amigos, invites, apuestas o rankings consistentes.</span>
              </div>
            </div>
            <p>
              Para refrescar presentacion sin token, consulta
              <code>GET /api/v1/players/{npub}/profile</code>.
            </p>
          </section>

          <section id="apuestas">
            <h2>4. Apuestas y escrow <span class="badge money">API key</span></h2>
            <p class="section-lead">
              Tu game server crea el pozo; Luna Negra custodia los depositos y paga a
              los ganadores. El contrato se publica firmado en Nostr y se verifica antes
              de liquidar.
            </p>

            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>Los jugadores depositan sats antes de competir. Luna Negra guarda el pozo y paga cuando tu servidor informa el resultado.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>Tu backend usa la API key para crear la apuesta, consultar depositos y reportar ganadores. El cliente nunca decide premios.</span>
              </div>
            </div>

            <div class="timeline">
              <div class="timeline-item"><b>01</b><strong>Crear pozo</strong><span><code>POST /api/v1/bets</code> con participantes, stake y metadata.</span></div>
              <div class="timeline-item"><b>02</b><strong>Recibir depositos</strong><span><code>GET /api/v1/bets/{id}</code> trae estado y handles de pago.</span></div>
              <div class="timeline-item"><b>03</b><strong>Resolver</strong><span><code>POST /api/v1/bets/{id}/result</code> reporta ganadores o empate.</span></div>
            </div>

            <h3>Flujo minimo</h3>
            <pre><code>// 1) Crear apuesta winner-takes-all
POST /api/v1/bets
{
  "gameId": "game_...",
  "participants": ["npub1...", "npub1..."],
  "stakeSats": 10,
  "roomId": "room-42",
  "metadata": { "matchId": "m-1007" }
}

// 2) Consultar estado y pagos
GET /api/v1/bets/{id}
// status: pending_deposits | funded | settled | cancelled | expired | refunded

// 3) Resolver o cancelar
POST /api/v1/bets/{id}/result  { "winners": ["npub1ganador..."] }
POST /api/v1/bets/{id}/cancel</code></pre>

            <p class="note">
              <strong>Idempotencia:</strong> <code>POST /bets</code> acepta
              <code>Idempotency-Key</code> y <code>/result</code> responde OK si la apuesta
              ya estaba en estado terminal. Eso simplifica reintentos desde tu backend.
            </p>
          </section>

          <section id="multijugador">
            <h2>5. Multijugador, presencia y social</h2>
            <p class="section-lead">
              Si tu juego no tiene backend completo, Luna Negra puede cubrir invites,
              presencia, roster y un estado compartido simple por sala.
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>La plataforma ayuda a saber quien esta online, invitar amigos y sostener una sala simple sin armar infraestructura propia.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>Los invites usan tokens de sala. La presencia y el estado compartido se actualizan por polling y tienen TTL corto.</span>
              </div>
            </div>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Endpoint</th><th>Auth</th><th>Uso</th></tr>
                </thead>
                <tbody>
                  <tr><td><span class="method">GET</span> <code>/api/v1/rooms/verify</code></td><td>Bearer invite</td><td>Valida el token de un jugador que entra a una sala.</td></tr>
                  <tr><td><span class="method post">POST</span> <code>/api/v1/rooms/{roomId}/presence</code></td><td>Bearer invite</td><td>Heartbeat y roster de sala.</td></tr>
                  <tr><td><span class="method post">POST</span> <code>/api/v1/rooms/{roomId}/state</code></td><td>Bearer invite</td><td>Escribe estado compartido y estado propio del jugador.</td></tr>
                  <tr><td><span class="method">GET</span> <code>/api/v1/rooms/{roomId}/state</code></td><td>Bearer invite</td><td>Lee estado, version, members y soporta <code>ETag</code>.</td></tr>
                  <tr><td><span class="method post">POST</span> <code>/api/v1/presence</code></td><td>API key</td><td>Presencia global del jugador en tu juego.</td></tr>
                  <tr><td><span class="method">GET</span> <code>/api/v1/friends</code></td><td>API key</td><td>Amigos NIP-02 con presencia y busqueda.</td></tr>
                  <tr><td><span class="method post">POST</span> <code>/api/v1/invites</code></td><td>API key</td><td>Invita a un amigo a una sala o deja launch pendiente.</td></tr>
                </tbody>
              </table>
            </div>
            <h3>Estado compartido de sala</h3>
            <pre><code>POST /api/v1/rooms/{roomId}/state
{
  "set": { "turno": "x", "tablero": ["x", null, "o"] },
  "self": { "listo": true },
  "version": 3
}

GET /api/v1/rooms/{roomId}/state
// -&gt; { data, version, members: [{ npub, name, avatar, state }] }</code></pre>
          </section>

          <section id="leaderboards">
            <h2>6. Marcadores <span class="badge">Bearer entitlement</span></h2>
            <p class="section-lead">
              Rankings por juego. El <code>name</code> lo define tu juego:
              <code>semanal</code>, <code>clasico</code>, <code>speedrun</code>. La politica
              actual conserva el mejor puntaje.
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>Sirven para mostrar rankings y competencia social. No son una fuente segura para repartir dinero.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>El cliente reporta scores con el entitlement. Para apuestas, el resultado siempre debe venir del game server.</span>
              </div>
            </div>
            <div class="two-col">
              <pre><code>POST /api/v1/leaderboards/{name}/scores
{ "score": 1234 }
// -&gt; { score, rank, improved }

GET /api/v1/leaderboards/{name}?window=all&amp;view=top
// -&gt; { entries: [{ npub, displayName, score, rank }] }</code></pre>
              <p class="note danger">
                <strong>Anti-trampa:</strong> el puntaje lo manda el cliente y puede falsificarse.
                No lo uses para resolver apuestas. El resultado con dinero siempre debe venir
                de tu game server por <code>/bets/{id}/result</code>.
              </p>
            </div>
          </section>

          <section id="webhooks">
            <h2>7. Webhooks <span class="badge money">API key</span></h2>
            <p class="section-lead">
              Registra una URL y Luna Negra envia eventos firmados con
              <code>X-LunaNegra-Signature</code>. La firma es HMAC-SHA256 del cuerpo crudo
              usando tu secreto <code>whsec_...</code>.
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>Tu servidor recibe avisos automaticos cuando hay compras, depositos, apuestas resueltas o pagos enviados.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span>Verifica la firma HMAC antes de confiar en el evento. Usa el cuerpo crudo y el secreto <code>whsec_...</code>.</span>
              </div>
            </div>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Evento</th><th>Cuando ocurre</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>purchase.completed</code></td><td>Un jugador compro tu juego.</td></tr>
                  <tr><td><code>deposit.received</code></td><td>Un participante deposito su stake.</td></tr>
                  <tr><td><code>bet.funded</code></td><td>El pozo completo todos los depositos.</td></tr>
                  <tr><td><code>bet.settled</code></td><td>Apuesta resuelta y pagada.</td></tr>
                  <tr><td><code>bet.cancelled</code>, <code>bet.expired</code>, <code>bet.refunded</code></td><td>Cancelacion, vencimiento o reembolso.</td></tr>
                  <tr><td><code>payout.sent</code></td><td>Se envio tu parte de una compra.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="sdk">
            <h2>8. SDK de TypeScript</h2>
            <p class="section-lead">
              El SDK envuelve el contrato publico para game servers: validacion offline,
              apuestas, webhooks, perfiles y actividad.
            </p>
            <pre><code>npm i jose

import { createClient, verifyWebhook } from "@lunanegra/sdk";

const luna = createClient({
  baseUrl: "https://&lt;LUNA_NEGRA&gt;",
  apiKey: process.env.LUNA_NEGRA_API_KEY,
});

const entitlement = await luna.verifyAccess(lnToken);
const bet = await luna.createBet({ gameId, participants, stakeSats: 10 });
const info = await luna.getBet(bet.betId);
await luna.reportWinners(bet.betId, [winnerNpub]);</code></pre>
          </section>

          <section id="endpoints">
            <h2>9. Referencia rapida de endpoints</h2>
            <p class="section-lead">
              Para campos completos, codigos de error y schemas, usa
              <a href="/developers">/developers</a> o <a href="/openapi.json">/openapi.json</a>.
            </p>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Metodo</th><th>Endpoint</th><th>Auth</th></tr>
                </thead>
                <tbody>
                  <tr><td><span class="method">GET</span></td><td><code>/.well-known/jwks.json</code></td><td>Publico</td></tr>
                  <tr><td><span class="method">GET</span></td><td><code>/api/v1/session</code></td><td>Bearer entitlement</td></tr>
                  <tr><td><span class="method">GET</span></td><td><code>/api/v1/entitlements/verify</code></td><td>Bearer entitlement</td></tr>
                  <tr><td><span class="method">GET</span></td><td><code>/api/v1/rooms/verify</code></td><td>Bearer invite</td></tr>
                  <tr><td><span class="method post">POST</span></td><td><code>/api/v1/rooms/{roomId}/presence</code></td><td>Bearer invite</td></tr>
                  <tr><td><span class="method">GET</span> <span class="method post">POST</span></td><td><code>/api/v1/rooms/{roomId}/state</code></td><td>Bearer invite</td></tr>
                  <tr><td><span class="method post">POST</span></td><td><code>/api/v1/presence</code></td><td>API key</td></tr>
                  <tr><td><span class="method">GET</span></td><td><code>/api/v1/friends</code></td><td>API key</td></tr>
                  <tr><td><span class="method post">POST</span></td><td><code>/api/v1/invites</code></td><td>API key</td></tr>
                  <tr><td><span class="method">GET</span> <span class="method post">POST</span></td><td><code>/api/v1/leaderboards/{name}</code> / <code>/scores</code></td><td>Bearer entitlement</td></tr>
                  <tr><td><span class="method money">POST</span></td><td><code>/api/v1/bets</code></td><td>API key</td></tr>
                  <tr><td><span class="method">GET</span></td><td><code>/api/v1/bets/{id}</code></td><td>API key</td></tr>
                  <tr><td><span class="method money">POST</span></td><td><code>/api/v1/bets/{id}/result</code></td><td>API key o evento firmado</td></tr>
                  <tr><td><span class="method post">POST</span></td><td><code>/api/v1/games/{slug}/activity</code></td><td>API key</td></tr>
                  <tr><td><span class="method">GET</span> <span class="method post">POST</span></td><td><code>/api/v1/provider/webhook</code></td><td>API key</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          </details>
        </article>
      </div>
    </main>

    <footer class="footer shell">
      Esta es la interfaz REST v1, en vias de discontinuacion. Para nuevas
      integraciones usa <a href="/dev">NGP</a>. El contrato completo de la 1.0 vive en
      <a href="/developers">/developers</a> y <a href="/openapi.json">/openapi.json</a>.
    </footer>`;

export function GET(req: Request) {
  // Las líneas de instalación necesitan la URL real del deploy: la derivamos de
  // las cabeceras y reemplazamos el placeholder antes de servir.
  const origin = originFrom(req);
  const html = devGuideDoc({
    title: "Luna Negra · API REST v1 (version vieja) para developers",
    description:
      "Version vieja: guia de la interfaz REST v1 dependiente de Luna Negra (login SSO, escrow, salas, marcadores, webhooks). En vias de discontinuacion; usa NGP en /dev.",
    body: BODY,
  }).replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
