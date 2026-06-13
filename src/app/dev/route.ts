// Guía para desarrolladores de Luna Negra, en español (rioplatense). Página
// autocontenida (HTML + CSS inline, sin dependencias del bundle). Complementa a
// `/developers` (referencia interactiva sobre /openapi.json) y a /openapi.json
// (el contrato). El contenido refleja el contrato público de `docs/api-publica.md`.

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Luna Negra · Guía para desarrolladores</title>
    <style>
      :root {
        --bg: #0c0b10; --panel: #15131d; --border: #2a2740;
        --ink: #ece9f5; --muted: #a39fb8; --accent: #b794f6; --accent2: #7f5af0;
        --code-bg: #1c1930; --ok: #6ee7b7; --warn: #fbbf24;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: var(--bg); color: var(--ink);
        font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .wrap { max-width: 880px; margin: 0 auto; padding: 48px 24px 96px; }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      h1 { font-size: 2rem; margin: 0 0 8px; }
      h2 { font-size: 1.4rem; margin: 48px 0 12px; padding-top: 12px; border-top: 1px solid var(--border); }
      h3 { font-size: 1.1rem; margin: 28px 0 8px; color: var(--accent); }
      p, li { color: var(--ink); }
      .lead { color: var(--muted); font-size: 1.05rem; }
      code { background: var(--code-bg); padding: 2px 6px; border-radius: 6px; font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace; font-size: .9em; }
      pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; overflow-x: auto; }
      pre code { background: none; padding: 0; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: .92rem; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
      th { color: var(--muted); font-weight: 600; }
      td code { white-space: nowrap; }
      .pill { display: inline-block; background: var(--accent2); color: #fff; font-size: .72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0; }
      .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
      .card h3 { margin-top: 0; }
      .note { background: var(--panel); border-left: 3px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
      .warn { border-left-color: var(--warn); }
      .muted { color: var(--muted); }
      footer { margin-top: 64px; color: var(--muted); font-size: .9rem; border-top: 1px solid var(--border); padding-top: 24px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Luna Negra · Guía para desarrolladores 🌑</h1>
      <p class="lead">
        Todo lo que necesitás para integrar tu juego con Luna Negra: identidad de los
        jugadores, multijugador, apuestas en Lightning (sats), presencia, marcador y avisos.
        Acá va la guía en prosa; si querés probar los endpoints en vivo tenés la
        <a href="/developers">referencia interactiva</a> y el contrato crudo en
        <a href="/openapi.json"><code>/openapi.json</code></a>.
      </p>

      <div class="cards">
        <div class="card"><h3>Referencia interactiva</h3><p class="muted">Probá cada endpoint desde el navegador.</p><a href="/developers">Abrir /developers →</a></div>
        <div class="card"><h3>Contrato OpenAPI</h3><p class="muted">La fuente de verdad, machine-readable.</p><a href="/openapi.json">Ver /openapi.json →</a></div>
        <div class="card"><h3>Claves públicas</h3><p class="muted">Para validar tokens offline (ES256).</p><a href="/.well-known/jwks.json">Ver JWKS →</a></div>
      </div>

      <h2>1. Cómo funciona, en dos minutos</h2>
      <p>
        Tu juego es un <strong>proveedor</strong> (provider) en Luna Negra. Desde el panel
        <a href="/provider">/provider</a> creás tu juego y obtenés una <strong>API key</strong>
        (<code>ln_sk_…</code>) que vive <em>solo en tu servidor</em> — nunca la mandes al navegador.
      </p>
      <p>
        Luna Negra abre tu juego con un token en la URL (<code>?lnToken=&lt;jwt&gt;</code>): ese
        es el <strong>entitlement</strong>, la prueba de que el jugador puede jugar. Tu juego lo
        canjea por la identidad del jugador y listo: no hace falta que el jugador se registre de nuevo.
      </p>

      <h3>Los tres tipos de credencial</h3>
      <table>
        <tr><th>Credencial</th><th>Quién la usa</th><th>Para qué</th></tr>
        <tr><td><span class="pill">API key</span> <code>ln_sk_…</code></td><td>Tu <strong>servidor</strong></td><td>Crear apuestas, presencia global, amigos, invitaciones, webhooks, actividad.</td></tr>
        <tr><td><span class="pill">entitlement</span> (lnToken)</td><td>El <strong>jugador</strong> (cliente)</td><td>Login SSO (<code>/session</code>) y marcador. Es corto (~5 min): canjealo al cargar.</td></tr>
        <tr><td><span class="pill">invite</span> (token de sala)</td><td>El <strong>jugador</strong> (cliente)</td><td>Entrar a una sala multijugador: presencia y estado de sala.</td></tr>
      </table>
      <p class="muted">
        Los tokens son JWT firmados con <strong>ES256</strong>: podés validarlos <strong>offline</strong>
        con la clave pública de <a href="/.well-known/jwks.json"><code>/.well-known/jwks.json</code></a>
        (recomendado) o contra los endpoints <code>/verify</code>.
      </p>

      <h2>2. Convenciones</h2>
      <ul>
        <li><strong>Auth:</strong> siempre <code>Authorization: Bearer &lt;token&gt;</code> (sea API key o JWT).</li>
        <li><strong>Plata:</strong> todo en <strong>sats</strong> de cara afuera (internamente msat).</li>
        <li><strong>Errores:</strong> forma estándar <code>{ "error": { "code", "message" } }</code> con el status HTTP que corresponda. El <code>code</code> es estable; el <code>message</code> es legible.</li>
        <li><strong>Éxito:</strong> el cuerpo es el objeto crudo (sin envelope <code>{ data }</code>).</li>
        <li><strong>Caché:</strong> los GET de apuesta y de estado vienen con <code>Cache-Control: no-store</code> — siempre frescos, no necesitás cache-busting.</li>
        <li><strong>Idempotencia:</strong> <code>POST /bets</code> acepta <code>Idempotency-Key</code>; <code>/result</code> es idempotente (re-reportar devuelve 200, no error).</li>
        <li><strong>CORS</strong> abierto: podés llamar desde el cliente del juego donde corresponda.</li>
      </ul>

      <h2>3. Identidad y login SSO</h2>
      <p>Tu juego se abre con <code>?lnToken=&lt;entitlement&gt;</code>. Canjealo una vez:</p>
      <pre><code>// En tu server (o cliente), con el lnToken que vino en la URL:
const r = await fetch("https://luna-negra/api/v1/session", {
  headers: { authorization: "Bearer " + lnToken },
});
const { npub, pubkey, displayName, avatarUrl, gameId } = await r.json();
// Guardá la IDENTIDAD (npub), no el token: el entitlement expira a ~5 min.</code></pre>
      <p class="muted">
        El <code>npub</code> es la identidad <strong>estable</strong> del jugador: usalo como su id,
        nunca generes un UUID local. Para refrescar nombre/avatar sin token:
        <code>GET /api/v1/players/{npub}/profile</code>.
      </p>

      <h2>4. Apuestas / escrow <span class="pill">API key</span></h2>
      <p>
        Tu game server crea la apuesta; Luna Negra <strong>custodia el pozo</strong> y le paga a los
        ganadores (menos un fee configurable). El contrato se publica <strong>firmado en Nostr</strong> y
        se verifica antes de pagar (<code>CONTRACT_MISMATCH</code>).
      </p>
      <pre><code>// 1) Crear el pozo (winner-takes-all)
POST /api/v1/bets
{ "gameId", "participants": ["npub1","npub2"], "stakeSats": 10,
  "victoryCondition"?, "roomId"?, "metadata"? }

// 2) Estado + handles de pago en UNA llamada (polling)
GET /api/v1/bets/{id}
// → { status, depositsReceived, depositsTotal, potSats, participants:[
//      { npub, depositStatus, payoutSats, bolt11, lnurl, payUrl } ], ... }
//   Los handles van null cuando el depósito ya cerró/pagó.

// 3a) Resolver: reportás los ganadores; Luna Negra firma con tu oráculo gestionado.
POST /api/v1/bets/{id}/result   { "winners": ["npubGanador"] }   // [] = empate → reembolso
// 3b) …o cancelar antes de resolver (reembolsa depósitos)
POST /api/v1/bets/{id}/cancel</code></pre>
      <div class="note">
        <strong>Estados de apuesta:</strong> <code>pending_deposits → funded → settled</code>
        (o <code>cancelled</code> / <code>expired</code> / <code>refunded</code>).
        <strong>Depósito:</strong> <code>pending | paid | refunded | failed</code>.
        Un único vocabulario en toda la API.
      </div>

      <h2>5. Multijugador, presencia y social</h2>
      <table>
        <tr><th>Endpoint</th><th>Auth</th><th>Qué hace</th></tr>
        <tr><td><code>GET /api/v1/rooms/verify</code></td><td>Bearer invite</td><td>Valida el token de un jugador que entra a una sala.</td></tr>
        <tr><td><code>POST /api/v1/rooms/{roomId}/presence</code></td><td>Bearer invite</td><td>Heartbeat + roster de la sala (~2 s).</td></tr>
        <tr><td><code>POST /api/v1/presence</code></td><td>API key</td><td>Presencia global del jugador en tu juego (TTL ~30 s). Bolsa libre <code>state</code>.</td></tr>
        <tr><td><code>GET /api/v1/friends</code></td><td>API key</td><td>Amigos (NIP-02) con su presencia y <code>state</code>.</td></tr>
        <tr><td><code>POST·GET /api/v1/invites</code></td><td>API key</td><td>Invitar a un amigo a una sala / consultar el launch pendiente.</td></tr>
      </table>

      <h3>Estado compartido de sala <span class="pill">Bearer invite</span></h3>
      <p>
        ¿Tu juego <strong>no tiene backend propio</strong>? Luna Negra te hostea el "tablero común"
        (bolsa key/value, estilo <code>SetLobbyData</code> de Steam) más el estado por jugador.
        La plataforma no interpreta las claves: el significado lo ponés vos.
      </p>
      <pre><code>// Escribir (mezcla por clave, last-write-wins; cada POST es heartbeat)
POST /api/v1/rooms/{roomId}/state
{ "set": { "turno": "x", "tablero": [...] },   // bolsa compartida (≤8KB)
  "self": { "listo": true },                   // tu bolsa de jugador (≤2KB)
  "version": 3 }                               // opcional: concurrencia optimista (CAS)

// Leer (polling barato con ETag → 304 si no cambió)
GET /api/v1/rooms/{roomId}/state
// → { data, version, members: [{ npub, name, avatar, state }] }</code></pre>

      <h2>6. Marcador <span class="pill">Bearer entitlement</span></h2>
      <p>Rankings por juego. El <code>name</code> lo elegís vos (<code>semanal</code>, <code>clasico</code>, …). Política "se queda el mejor".</p>
      <pre><code>POST /api/v1/leaderboards/{name}/scores   { "score": 1234 }
// → { score, rank, improved }   (improved:false si no superó su récord)

GET /api/v1/leaderboards/{name}?window=all|week&view=top|around&npub=
// → { entries: [{ npub, displayName, score, rank }] }</code></pre>
      <div class="note warn">
        ⚠️ <strong>Anti-trampa.</strong> El puntaje lo manda el cliente y es <strong>falsificable</strong>.
        El marcador sirve para <strong>mostrar</strong> rankings (como Steam), <strong>NO</strong> para
        resolver apuestas: el resultado de una apuesta siempre viene de tu game server por
        <code>/bets/{id}/result</code> (firmado por el oráculo). No lo uses como fuente de verdad de plata.
      </div>

      <h2>7. Webhooks <span class="pill">API key</span></h2>
      <p>
        Registrás tu URL con <code>POST /api/v1/provider/webhook</code> y Luna Negra te avisa los
        eventos con un <strong>POST JSON</strong> firmado (cabecera <code>X-LunaNegra-Signature</code>,
        HMAC-SHA256 del cuerpo crudo con tu secreto <code>whsec_…</code>). Cuerpo:
        <code>{ id, type, created, data }</code>.
      </p>
      <table>
        <tr><th>Evento</th><th>Cuándo</th></tr>
        <tr><td><code>purchase.completed</code></td><td>un jugador compró tu juego</td></tr>
        <tr><td><code>deposit.received</code></td><td>un participante depositó su stake</td></tr>
        <tr><td><code>bet.funded</code></td><td>el pozo se completó</td></tr>
        <tr><td><code>bet.settled</code></td><td>apuesta resuelta y pagada</td></tr>
        <tr><td><code>bet.cancelled</code> · <code>bet.expired</code> · <code>bet.refunded</code></td><td>cancelación / vencimiento / reembolso</td></tr>
        <tr><td><code>payout.sent</code></td><td>te enviamos tu parte de una compra</td></tr>
      </table>
      <p class="muted">Todos los eventos de apuesta incluyen <code>roomId</code> y <code>metadata</code> para que correlaciones con tu sala sin guardar una tabla aparte.</p>

      <h2>8. SDK de TypeScript</h2>
      <p>Un wrapper para game servers: valida tokens offline y envuelve los endpoints de API key.</p>
      <pre><code>npm i jose   // peer dependency

import { createClient, verifyWebhook } from "@luna-negra/sdk";
const luna = createClient({ baseUrl: "https://luna-negra", apiKey: process.env.LUNA_NEGRA_API_KEY });

const ent = await luna.verifyAccess(lnToken);     // valida el entitlement (offline)
const bet = await luna.createBet({ gameId, participants, stakeSats: 10 });
const info = await luna.getBet(bet.betId);          // estado + handles de pago
await luna.reportWinners(bet.betId, [npubGanador]); // resolver (idempotente)</code></pre>

      <footer>
        <p>
          Esto es la guía en prosa. Para el detalle campo por campo y probar en vivo:
          <a href="/developers">referencia interactiva</a> · <a href="/openapi.json">/openapi.json</a>.
          ¿Dudas? Escribinos desde el panel <a href="/provider">/provider</a>.
        </p>
      </footer>
    </div>
  </body>
</html>`;

export function GET() {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
