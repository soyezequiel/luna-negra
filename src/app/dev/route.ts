// Guia autocontenida para developers — Nostr Games Protocol (NGP).
//
// Esta es la interfaz recomendada: el juego se hace compatible con Luna Negra
// publicando eventos Nostr firmados (identidad, marcador, presencia, retos,
// reseñas, zaps y apuestas v2). No depende de la API REST central: cualquier
// cliente Nostr lee los mismos eventos y sigue funcionando si Luna Negra cae.
//
// La vieja interfaz REST v1 (dependiente de Luna Negra) quedó en /dev/luna, en
// vías de discontinuación. Comparte estilo/scripts vía src/lib/dev-guide.ts.

import { devGuideDoc, originFrom } from "@/lib/dev-guide";

const BODY = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" aria-label="Volver a Luna Negra">
          <span class="brand-mark">LN</span>
          <span>Luna Negra</span>
        </a>
        <nav class="top-links" aria-label="Navegacion principal">
          <a href="#inicio">Inicio</a>
          <a href="#skill">Skill IA</a>
          <a href="#niveles">Niveles</a>
          <a href="#guia-manual">Guia manual</a>
          <a href="/dev/luna">Version vieja</a>
        </nav>
        <a class="top-action" href="/provider">Crear juego</a>
      </div>
    </header>

    <main id="inicio" class="shell">
      <div class="hero" style="grid-template-columns:minmax(0,1fr);">
        <div>
          <span class="eyebrow">Nostr Games Protocol &middot; NGP</span>
          <h1>Integra tu juego con eventos Nostr.</h1>
          <p class="lead">
            El jugador y el juego <strong>publican</strong> eventos Nostr firmados;
            Luna Negra los <strong>lee</strong>. Marcador, presencia, retos y zaps
            viven en los relays: siguen funcionando aunque Luna Negra desaparezca.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="#skill">Instalar skill NGP</a>
            <a class="button" href="#niveles">Ver niveles</a>
          </div>
        </div>
      </div>

      <div class="content">
        <aside class="toc" aria-label="Indice de secciones">
          <strong>Indice</strong>
          <nav>
            <a href="#skill">Skill para tu IA</a>
            <a href="#niveles">Niveles de adopcion</a>
            <a href="#guia-manual">Guia manual</a>
          </nav>
        </aside>

        <article class="article">
          <section id="skill">
            <h2>Integra con una skill de IA <span class="badge ok">recomendado</span></h2>
            <p class="section-lead">
              Instala el contexto de NGP una vez y pedi a tu agente que conecte solo
              lo que necesitas: login Nostr, marcador firmado, presencia, retos 1v1,
              reseñas, zaps o apuestas v2.
            </p>

            <div class="install-hero violet">
              <span class="step-label">Recomendado &middot; cualquier agente</span>
              <h3>Instala la skill NGP desde este deploy</h3>
              <div class="cmd">
                <button type="button" class="copy-btn" aria-label="Copiar comando PowerShell">Copiar</button>
                <pre><code>iwr -useb "__LUNA_NEGRA_BASE__/dev/install?version=ngp&amp;ps" | iex</code></pre>
              </div>
              <div class="cmd" style="margin-top:8px;">
                <button type="button" class="copy-btn" aria-label="Copiar comando bash">Copiar</button>
                <pre><code>curl -fsSL "__LUNA_NEGRA_BASE__/dev/install?version=ngp" | sh</code></pre>
              </div>
              <p class="hint">
                Deja el <code>SKILL.md</code> de <code>integrar-ngp-v2</code> en la
                carpeta de skills de tu agente, con la URL de este deploy ya
                configurada. Despues reinicialo y pedi:
                <em>&ldquo;integra mi juego con NGP&rdquo;</em>.
              </p>
            </div>

            <p class="note violet">
              <strong>NGP es experimental, pero ya corre en produccion en Tetris.</strong>
              Identidad, marcador, presencia, retos, reseñas, zaps y apuestas v2 estan
              probados ahi. Que es solido, que es solo diseño y que queda fuera, abajo.
            </p>
            <details class="alt-install">
              <summary>Estado por capa y que NO cubre NGP todavia</summary>
              <p>
                <strong>Ya en produccion (Tetris):</strong> identidad, marcador
                (<code>kind:31337</code>), presencia (NIP-38), reto 1v1 (NIP-17), reseñas,
                zaps (NIP-57) y apuestas v2 por zaps.
              </p>
              <p>
                <strong>Solo diseño:</strong> salas multijugador (NIP-29) y marcador
                verificado (<code>kind:31338</code>). Los <code>kind</code> propuestos
                pueden cambiar.
              </p>
              <p style="margin-bottom:16px;">
                <strong>Fuera de NGP:</strong> escrow REST, webhooks y compra de pago
                siguen en la <a href="/dev/luna">version vieja 1.0</a>.
              </p>
            </details>

            <details class="alt-install">
              <summary>Otras formas de instalarla</summary>
              <p>
                Podes descargar el <code>SKILL.md</code> autocontenido y pasarlo como
                contexto, o leerlo por URL.
              </p>
              <div class="card-grid">
                <div class="mini-card violet">
                  <strong>Descargar o pasar por URL</strong>
                  <p style="margin:6px 0 0;"><a class="button" href="/dev/skill?version=ngp" download="SKILL.md">Descargar SKILL.md</a></p>
                  <div class="cmd" style="margin-top:8px;">
                    <button type="button" class="copy-btn" aria-label="Copiar URL">Copiar</button>
                    <pre><code>__LUNA_NEGRA_BASE__/dev/skill?version=ngp</code></pre>
                  </div>
                  <span>Guardalo como <code>AGENTS.md</code> en la raiz del repo, o pasale esa URL al agente y pedile que la lea.</span>
                </div>
                <div class="mini-card info">
                  <strong>¿Necesitas escrow o compra de pago?</strong>
                  <p style="margin:6px 0 0;"><a class="button" href="/dev/luna">Skill REST 1.0 &rarr;</a></p>
                  <span>La skill <code>integrar-luna-negra-1-0</code> cubre acceso pago, webhooks y escrow REST. Convive con NGP.</span>
                </div>
              </div>
            </details>
          </section>

          <section id="niveles">
            <h2>Niveles de adopcion</h2>
            <p class="section-lead">
              NGP es un menu por niveles. Implementa hasta donde te sirva; cada nivel
              suma un tipo de evento y nada mas.
            </p>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Nivel</th><th>Que incluye</th><th>Para que juego</th></tr>
                </thead>
                <tbody>
                  <tr><td><span class="badge violet">N0</span> Identidad</td><td>Login NIP-07/46. Nada mas.</td><td>Todos. El minimo absoluto.</td></tr>
                  <tr><td><span class="badge violet">N1</span> Marcador</td><td>+ evento de score <code>kind:31337</code></td><td>Juegos con puntaje: arcade, runner, partido.</td></tr>
                  <tr><td><span class="badge violet">N2</span> Social</td><td>+ presencia NIP-38 + reseñas/logros <code>kind:1</code></td><td>Para aparecer en perfiles y feeds Nostr.</td></tr>
                  <tr><td><span class="badge violet">N3</span> Economico</td><td>+ zaps NIP-57. Escrow/compra siguen en 1.0.</td><td>Propinas y premios.</td></tr>
                </tbody>
              </table>
            </div>
            <p class="note">
              <strong>Multijugador con estado en vivo</strong> queda fuera del nucleo:
              es posible con eventos efimeros pero el esquema lo define cada juego.
              Para salas confiables usa <a href="/dev/luna#multijugador">salas REST 1.0</a>.
            </p>
          </section>

          <details class="manual" id="guia-manual">
            <summary class="manual-summary">
              <span class="manual-summary-text">
                <span class="manual-summary-main">Guia manual de eventos NGP</span>
                <span class="manual-summary-sub">Identidad, coordenada, marcador, presencia, retos, reseñas, zaps y apuestas v2. Abri solo lo que necesites.</span>
              </span>
            </summary>

          <p class="note">
            <strong>Todo lo de abajo esta probado en Tetra (Tetris).</strong>
            Los patrones, relays, tags y flujos son los que ya corren en produccion
            ahi, no diseño teorico. Cuando algo todavia es solo diseño (salas NIP-29,
            marcador verificado <code>kind:31338</code>) lo marcamos aparte.
          </p>

          <section id="relays">
            <h2>0. Relays probados <span class="badge ok">Tetris</span></h2>
            <p class="section-lead">
              Separa relays de lectura, de DM y de escritura publica. Un solo pool
              (<code>SimplePool</code>) singleton para todo. La causa mas comun de
              "publique pero no aparece" es escribir a un indexador de solo lectura.
            </p>
            <pre><code>// Lectura de perfiles/contactos/presencia (los mismos que usa la tienda)
const PROFILE_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol", "wss://relay.primal.net"];

// DMs / retos NIP-17 (escritura + lectura)
const DM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social"];

// Publicar metadata firmada por el usuario (presencia kind:30315, marcador kind:31337)
const PUBLIC_WRITE_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];</code></pre>
            <p class="note danger">
              <strong>No publiques a <code>relay.nostr.band</code>:</strong> es un
              indexador de solo lectura que rechaza escrituras. Va en
              <code>PROFILE_RELAYS</code> (igual reindexa lo que publicas en otros),
              pero no en los sets de escritura.
            </p>
          </section>

          <section id="identidad">
            <h2>1. Identidad Nostr</h2>
            <p class="section-lead">
              El jugador entra con un signer Nostr. El juego nunca crea cuentas: usa
              la <code>pubkey</code> como player id estable.
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>En simple</strong>
                <span>El jugador firma con su propia identidad Nostr (extension del navegador o firmador remoto por QR). No hay otra cuenta.</span>
              </div>
              <div class="explain">
                <strong>Detalle tecnico</strong>
                <span><code>window.nostr</code> (NIP-07) o bunker NIP-46. Persiste el metodo de signer, no solo la identidad.</span>
              </div>
            </div>
            <pre><code>async function getNostrIdentity() {
  if (!window.nostr) throw new Error("No hay signer NIP-07");
  const pubkey = await window.nostr.getPublicKey();
  return { pubkey };
}</code></pre>
            <p class="note">
              <strong>Espera la inyeccion:</strong> algunas extensiones agregan
              <code>window.nostr</code> despues de cargar la pagina. Sondea hasta ~3 s
              antes de rendirte. Con NIP-46, no firmes en cada heartbeat: cada firma
              puede disparar un prompt.
            </p>
          </section>

          <section id="coordenada">
            <h2>2. La "direccion" del juego <span class="badge violet">gameCoord</span></h2>
            <p class="section-lead">
              Pensala como la direccion postal del juego: una etiqueta unica que no
              cambia y que no depende de Luna Negra. Cada cosa que se publica (un
              puntaje, "esta jugando", una reseña) lleva esa direccion, asi cualquiera
              sabe a que juego pertenece. Tecnicamente es una coordenada NIP-23.
            </p>
            <pre><code>30023:&lt;pubkey-de-la-tienda&gt;:&lt;slug&gt;</code></pre>
            <div class="two-col">
              <div class="mini-card info">
                <strong>Es el <code>a</code>-tag de todo</strong>
                <span>Scores, presencia y actividad se anclan a esta coordenada. Existe mientras exista el articulo <code>kind:30023</code> del juego en algun relay: no depende de Luna Negra.</span>
              </div>
              <div class="mini-card violet">
                <strong>No la inventes</strong>
                <span>Obtenela de <code>GET __LUNA_NEGRA_BASE__/api/v1/session</code> cuando el juego se abrio con 1.0, o del <code>kind:30023</code> real. El <code>slug</code> no siempre coincide con el nombre visible.</span>
              </div>
            </div>
            <pre><code>// Leer la coordenada real desde relays
{ kinds: [30023], "#d": ["&lt;slug&gt;"] }</code></pre>
          </section>

          <section id="marcador">
            <h2>3. Marcador <span class="kind">kind:31337</span> <span class="badge ok">implementado</span></h2>
            <p class="section-lead">
              El jugador firma su mejor puntaje y lo publica a relays. Luna Negra lo
              proyecta al mismo ranking que el camino REST, pero cualquier cliente
              Nostr tambien lo lee. Es lo unico que esta spec define nuevo.
            </p>
            <pre><code>import { SimplePool } from "nostr-tools";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const board = "clasico";

const evt = await window.nostr.signEvent({
  kind: 31337,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", gameCoord],                    // GAME — ancla
    ["d", \`\${gameCoord}:\${board}\`],      // un registro por jugador y tabla
    ["board", board],                    // ^[a-z0-9][a-z0-9_-]{0,63}$
    ["score", String(puntaje)],          // entero no negativo, como string
    ["client", "tu-juego"],
  ],
  content: "",
});

await Promise.any(new SimplePool().publish(RELAYS, evt));</code></pre>
            <h3>Leer el ranking sin Luna Negra</h3>
            <pre><code>{ kinds: [31337], "#a": [gameCoord], "#board": [board] }
// agrupa por pubkey, quedate con el mejor score segun la unidad</code></pre>
            <p class="note"><span class="badge ok">Tetris</span>
              Los nombres de <code>board</code> deben <strong>coincidir con los del
              camino REST</strong> para que ambos alimenten el mismo ranking (en Tetris:
              <code>victorias</code> y <code>supervivencia</code>). Clampea el
              <code>score</code> a <code>1_000_000_000</code>, valida el board con la
              regex antes de firmar, y separa <code>buildScoreEvent()</code> (firma, lanza
              si es invalido) de <code>publishScore()</code> (best-effort, no lanza).
            </p>
            <p class="note danger">
              <strong>Anti-trampa:</strong> el puntaje lo firma el cliente del jugador
              y es falsificable. Sirve para rankings sociales, no para repartir dinero.
              Para stakes existe el tier verificado <code>kind:31338</code> (oraculo, diseño).
            </p>
          </section>

          <section id="presencia">
            <h2>4. Presencia "jugando X" — NIP-38</h2>
            <p class="section-lead">
              El propio jugador firma su estado. No hace falta game server: Luna Negra
              y cualquier cliente derivan "Jugando &lt;juego&gt;" de este evento.
            </p>
            <pre><code>{
  "kind": 30315,
  "tags": [
    ["d", "general"],
    ["a", "30023:&lt;tienda&gt;:&lt;slug&gt;"],
    ["expiration", "&lt;unix + 60-240s&gt;"]
  ],
  "content": "Jugando Pac-Toshi"
}</code></pre>
            <div class="explain-grid">
              <div class="explain">
                <strong>TTL y refresco</strong>
                <span>Re-firma solo si cambio el estado o pasaron ~2 min. El <code>expiration</code> debe ser mayor que tu intervalo de heartbeat para evitar titileo. Con NIP-46 usa TTL alto (~240 s) para no firmar seguido.</span>
              </div>
              <div class="explain">
                <strong>Limpieza en logout</strong>
                <span>Firma <code>kind:30315</code> con <code>content:""</code> y <code>["expiration", "&lt;now+1&gt;"]</code> para que desaparezca sin esperar el TTL.</span>
              </div>
            </div>
            <p class="note"><span class="badge ok">Tetris</span>
              Separa <code>buildPresenceEvent()</code> (solo firma, testeable) de
              <code>publishPresence()</code> (best-effort con
              <code>Promise.any(pool.publish(PUBLIC_WRITE_RELAYS, evt))</code>). El
              <code>content</code> va <strong>sin emoji</strong>: Luna Negra antepone
              🎮 al mostrarlo, asi que otro emoji lo duplicaria. TTL real en Tetris: 240 s.
            </p>
          </section>

          <section id="retos">
            <h2>5. Retos e invitaciones — NIP-17 <span class="badge ok">reto 1v1 implementado</span></h2>
            <p class="section-lead">
              La invitacion es un reto cifrado E2E. El server no puede leerlo. El rumor
              interno es <code>kind:14</code> y viaja como gift-wrap <code>kind:1059</code>.
            </p>
            <pre><code>{
  "kind": 14,
  "pubkey": "&lt;retador&gt;",
  "tags": [
    ["p", "&lt;invitado&gt;"],
    ["game", "30023:&lt;tienda&gt;:&lt;slug&gt;"],
    ["url", "https://tu-juego.com/?room=..."],
    ["expiration", "&lt;unix&gt;"]
  ],
  "content": "Te reto a una partida"
}</code></pre>
            <p class="note danger">
              <strong>La causa mas comun de "reto enviado pero no llega"</strong> es
              publicar en un set de relays y escuchar en otro. Usa la misma
              <code>resolveDmRelays(pubkey)</code> en envio y recepcion, e incluye los
              <code>kind:10050</code> del destinatario.
            </p>
            <p>
              Al recibir: desenvolver <code>kind:1059</code> &rarr; seal <code>kind:13</code>
              &rarr; rumor <code>kind:14</code>, y verificar
              <code>rumor.pubkey === seal.pubkey</code> para evitar suplantacion.
              Rechazar retos vencidos, de otro <code>gameCoord</code> o de otro origin.
            </p>
            <p class="note"><span class="badge ok">Tetris</span>
              Arma los tres sobres (rumor <code>kind:14</code> &rarr; seal
              <code>kind:13</code> &rarr; gift-wrap <code>kind:1059</code>)
              <strong>a mano sobre el signer</strong>: los helpers <code>nip17</code>/<code>nip59</code>
              de nostr-tools exigen la clave privada cruda, que NIP-07/NIP-46 no exponen.
              El signer si ofrece <code>nip44Encrypt</code> + <code>signEvent</code>; la
              capa externa del gift-wrap usa una clave <strong>efimera</strong> local.
              Publica tambien una <strong>auto-copia</strong> hacia vos mismo para ver el
              reto en tu propio historial, y usa timestamps aleatorizados (hasta 2 dias
              atras, NIP-59) — por eso el inbox debe escuchar con lookback de ~3 dias, no
              <code>since: now()</code>. El tag <code>room</code> es opcional (solo si
              usas salas). Resolve de relays: <code>kind:10050</code> del destinatario +
              <code>DM_RELAYS</code> de fallback, la <strong>misma</strong> funcion en
              envio y recepcion.
            </p>
          </section>

          <section id="social">
            <h2>6. Reseñas, logros y zaps</h2>
            <p class="section-lead">
              Reseñas y logros cuelgan de la coordenada; los zaps NIP-57 sirven para
              propinas y premios sin escrow. Luna Negra ya los lee y muestra en la
              ficha del juego.
            </p>
            <h3>Reseñas / logros — <span class="kind">kind:1</span></h3>
            <pre><code>{
  "kind": 1,
  "tags": [["a", "30023:&lt;tienda&gt;:&lt;slug&gt;"]],
  "content": "Gran juego, nuevo logro desbloqueado"
}</code></pre>
            <h3>Zaps — NIP-57</h3>
            <p>
              Zap firmado por el usuario al dev, al ganador o a un evento del juego.
              Los recibos <code>kind:9735</code> verificados alimentan el "top de
              zappers" por juego y por dev.
            </p>
            <p class="note">
              <strong>No mezcles</strong> zaps libres con apuestas custodiadas. Si hay
              deposito, pozo y payout, usa el flujo de apuestas v2 por zaps.
            </p>
          </section>

          <section id="apuestas">
            <h2>7. Apuestas v2 por zaps <span class="badge ok">Tetris</span> <span class="badge warn">gated</span></h2>
            <p class="section-lead">
              Probado en Tetris en produccion, pero gated por deploy
              (<code>BETS_V2_ENABLED</code> en Luna). Aunque use zaps NIP-57 publicos,
              sigue siendo escrow custodial de Luna Negra y server-to-server: lo que
              cambia respecto a la apuesta REST v1 es el riel — depositos, premio y
              cortes quedan auditables como zaps en relays.
            </p>
            <div class="timeline">
              <div class="timeline-item"><b>01</b><strong>Crear pozo</strong><span><code>POST /api/v2/bets</code> desde tu game server con API key.</span></div>
              <div class="timeline-item"><b>02</b><strong>Deposito por zap</strong><span>El jugador firma un <code>kind:9734</code>; el server lo reenvia al callback y obtiene el invoice.</span></div>
              <div class="timeline-item"><b>03</b><strong>Resolver</strong><span><code>POST /api/v2/bets/{id}/result</code> desde el game server.</span></div>
            </div>
            <pre><code>POST /api/v2/bets             { gameId, participants, stakeSats, victoryCondition, roomId, metadata }
GET  /api/v2/bets/{id}        // estado + por participante: depositZapRequest (9734 sin firmar) + depositCallback
POST /api/v2/bets/{id}/result { "winners": ["npub1..."] }   // vacio = empate/anulacion (refund)
POST /api/v2/bets/{id}/cancel</code></pre>
            <h3>Deposito por zap (flujo probado en Tetris)</h3>
            <div class="two-col">
              <div class="mini-card info">
                <strong>Sin construir UI</strong>
                <span>Manda al jugador a <code>__LUNA_NEGRA_BASE__/apuestas/{betId}</code>: ahi firma el zap, paga y ve el estado.</span>
              </div>
              <div class="mini-card violet">
                <strong>UI propia (como Tetris)</strong>
                <span>El <code>GET</code> trae por participante <code>depositZapRequest</code> (9734 sin firmar) y <code>depositCallback</code> (LNURL-pay). El browser firma el 9734 y lo manda a TU backend; tu backend hace <code>GET depositCallback?amount=&lt;stakeSats*1000&gt;&amp;nostr=&lt;9734-firmado&gt;</code> y usa el <code>pr</code> como invoice.</span>
              </div>
            </div>
            <p class="note"><span class="badge ok">Tetris</span>
              El callback responde <code>200</code> incluso en error (formato LNURL
              <code>{ status:"ERROR", reason }</code>): el exito es que exista
              <code>pr</code>, no el status HTTP. Es <strong>idempotente</strong>: si ya
              hay <code>bolt11</code>, reusalo sin re-firmar. Persisti el <code>bolt11</code>
              localmente para que el QR sobreviva al polling, y no borres
              <code>depositZapRequest</code>+<code>depositCallback</code> mientras el
              deposito siga pendiente (evita parpadeos al fallback). Opcional: el jugador
              firma un <code>participationComment</code> con la misma identidad; si gana,
              el premio se ancla a su comentario (best-effort, no rompe el deposito).
            </p>
            <div class="explain-grid">
              <div class="explain">
                <strong>Errores a manejar</strong>
                <span><code>BETS_V2_DISABLED</code>: el deploy no tiene v2 (avisar claro). <code>ANCHOR_PUBLISH_FAILED</code>: no se pudo anclar el contrato en Nostr; sugerir reintentar.</span>
              </div>
              <div class="explain">
                <strong>Cobro del ganador</strong>
                <span>Con cuenta Luna: pago automatico (<code>payoutStatus: paid</code>). Invitado sin destino: queda <code>withdraw_pending</code> y reclama en <code>__LUNA_NEGRA_BASE__/apuestas/{betId}</code>.</span>
              </div>
            </div>
            <p class="note danger">
              <strong>El resultado viene del game server con API key</strong>, no del
              marcador cliente. Luna firma el resultado con el oraculo gestionado del
              proveedor; el juego no toca Nostr para esto. <code>winners</code> vacio =
              empate/anulacion &rarr; reembolso.
            </p>
          </section>

          <section id="que-no">
            <h2>8. Lo que NO se hace solo con eventos</h2>
            <p class="section-lead">
              Nostr es mensajeria firmada, no liquidacion de dinero. Estas piezas se
              quedan en la <a href="/dev/luna">interfaz REST 1.0</a> (por ahora en vias
              de discontinuacion, pero es lo unico que las cubre hoy):
            </p>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Caso</th><th>Por que no es NGP puro</th></tr>
                </thead>
                <tbody>
                  <tr><td>Escrow / apuestas</td><td>Retener stake y pagar al ganador exige un custodio. El escrow v1 vive en 1.0; apuestas v2 por zaps siguen siendo custodiales.</td></tr>
                  <tr><td>Compra de juego de pago</td><td>Alguien tiene que validar el pago Lightning antes de dar acceso.</td></tr>
                  <tr><td>Webhooks firmados</td><td>Avisos server-to-server con HMAC — no hay evento Nostr equivalente.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="kinds">
            <h2>9. Resumen de kinds</h2>
            <p class="section-lead">
              La spec completa vive en <code>docs/nostr-games-protocol.md</code>. Los
              <code>kind</code> marcados como propuesto pueden cambiar.
            </p>
            <div class="endpoint-table">
              <table>
                <thead>
                  <tr><th>Kind</th><th>Que</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  <tr><td><span class="kind">0</span></td><td>Perfil del jugador (NIP-01)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">1</span></td><td>Reseñas / comentarios / logros (tag <code>a</code>=GAME)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">30023</span></td><td>Articulo del juego (define la coordenada)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">30315</span></td><td>Presencia "jugando X" (NIP-38)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">1059</span></td><td>Reto/invitacion gift-wrap (NIP-17)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">9735</span></td><td>Recibo de zap (NIP-57)</td><td>estandar</td></tr>
                  <tr><td><span class="kind">31337</span></td><td>Mejor puntaje del jugador</td><td>propuesto &middot; implementado</td></tr>
                  <tr><td><span class="kind">31338</span></td><td>Atestacion de puntaje (oraculo)</td><td>propuesto &middot; diseño</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          </details>
        </article>
      </div>
    </main>

    <footer class="footer shell">
      NGP es una capa experimental sobre eventos Nostr. La interfaz REST 1.0
      dependiente de Luna Negra quedo en <a href="/dev/luna">/dev/luna</a> y se esta
      dejando de usar. Spec completa en <code>docs/nostr-games-protocol.md</code>.
    </footer>`;

export function GET(req: Request) {
  // Las líneas de instalación necesitan la URL real del deploy: la derivamos de
  // las cabeceras y reemplazamos el placeholder antes de servir.
  const origin = originFrom(req);
  const html = devGuideDoc({
    title: "Luna Negra · Nostr Games Protocol (NGP) para developers",
    description:
      "Integra tu juego con Luna Negra usando eventos Nostr (NGP): login NIP-07/46, marcador kind:31337, presencia NIP-38, retos NIP-17, reseñas, zaps y apuestas v2.",
    body: BODY,
  }).replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
