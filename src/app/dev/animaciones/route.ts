// Animaciones de los protocolos — página pública autocontenida.
//
// Publica las 3 animaciones (NGP, Luna Room Link, NGE) que hasta ahora vivían
// sueltas, para que los developers entiendan de un vistazo lo que la guía de
// /dev explica con texto y código. Mismo diseño "Eclipse" que /dev: fondo
// negro, violeta #9d8cff / dorado #ffb648 / verde #4fe6a8, Bricolage Grotesque
// + Geist. HTML + CSS + JS inline, sin bundle de React.
//
// Cada animación es un HTML autocontenido servido como estático desde
// /public/animaciones/*.html (construido con el motor de animación propio, que
// expone un scrubber y un evento de seek). Acá NO se toca su contenido: se
// cargan en un <iframe> perezoso al darle play, se les oculta su barra gris
// interna y se manejan desde afuera con una barra de transporte "Eclipse"
// (volver al inicio, ±1s, play/pausa y scrub), vía los hooks documentados del
// motor: el evento `data-om-seek-to-time-frame` sobre el <svg> y la tecla
// espacio. El tiempo/estado se lee sondeando la barra interna oculta.

type Anim = {
  key: string;
  id: string;
  src: string;
  title: string;
  badge: string;
  spec: string;
  name: string;
  desc: string;
  when: string;
  acc: string; // hex
  rgb: string; // "r,g,b"
  play: string; // color del triángulo de play (oscuro sobre el acento)
  motif: string; // SVG del póster
};

const ANIMS: Anim[] = [
  {
    key: "ngp",
    id: "ngp",
    src: "/animaciones/ngp.html",
    title: "NGP · Nostr Games Protocol",
    badge: "NGP",
    spec: "Capa de eventos públicos · identidad · marcador · presencia",
    name: "Nostr Games Protocol",
    desc:
      'El jugador <strong>firma</strong> el evento con su llave, los <strong>relays</strong> lo guardan y <strong>cualquier cliente</strong> lo lee. La animación sigue un puntaje desde la firma hasta el ranking, sin API central en el medio.',
    when:
      "<b>Cuándo te importa:</b> login Nostr, marcador firmado, presencia o reseñas.",
    acc: "#9d8cff",
    rgb: "157,140,255",
    play: "#14102a",
    motif: `
      <circle cx="200" cy="108" r="44" fill="#0a0810" stroke="#c2b5ff" stroke-width="2.5"></circle>
      <circle cx="200" cy="108" r="60" fill="none" stroke="#ffb648" stroke-width="1" opacity="0.5"></circle>
      <g class="an-orbit" style="transform-origin:200px 108px;">
        <circle cx="96" cy="48" r="6" fill="#9d8cff"></circle>
        <circle cx="318" cy="62" r="6" fill="#4fe6a8"></circle>
        <circle cx="312" cy="172" r="6" fill="#ffb648"></circle>
      </g>
      <text x="200" y="118" font-family="'Bricolage Grotesque',sans-serif" font-size="28" font-weight="800" fill="#e9e6f2" text-anchor="middle">NGP</text>`,
  },
  {
    key: "room",
    id: "room-link",
    src: "/animaciones/room-link.html",
    title: "Luna Room Link",
    badge: "Room Link",
    spec: "Estándar de invitación a salas · ?lnRoom · sala lazy",
    name: "Luna Room Link",
    desc:
      'Luna arma el enlace de invitación <strong>desde la ficha, sin abrir el juego</strong>. El link lleva tu dominio y la sala se crea <em>lazy</em> en tu backend al primer acceso. La animación arma el link y lo sigue hasta la sala.',
    when:
      '<b>Cuándo te importa:</b> botón "Invitar a jugar" en Luna con un link a tu dominio.',
    acc: "#4fe6a8",
    rgb: "79,230,168",
    play: "#062017",
    motif: `
      <defs><radialGradient id="rl-m" cx="35%" cy="32%" r="70%"><stop offset="0%" stop-color="#c2b5ff"></stop><stop offset="48%" stop-color="#9d8cff"></stop><stop offset="100%" stop-color="#7d6cf0"></stop></radialGradient></defs>
      <circle cx="200" cy="90" r="48" fill="url(#rl-m)"></circle>
      <circle cx="222" cy="78" r="44" fill="#050409"></circle>
      <line x1="120" y1="165" x2="280" y2="165" stroke="#4fe6a8" stroke-width="2.5" stroke-dasharray="7 7"></line>
      <circle cx="120" cy="165" r="7" fill="#9d8cff"></circle>
      <circle cx="280" cy="165" r="7" fill="#4fe6a8"></circle>`,
  },
  {
    key: "nge",
    id: "nge",
    src: "/animaciones/nge.html",
    title: "NGE · Nostr Game Escrow",
    badge: "NGE",
    spec: "Canal RPC cifrado · escrow · estilo NWC · NIP-44",
    name: "Nostr Game Escrow",
    desc:
      'El caño <strong>privado y cifrado</strong> entre tu juego y el escrow de Luna, calcado de NWC. La animación abre el canal debajo del capó: crear la apuesta, custodiar depósitos, resolver y pagar — con liquidación pública auditable al final.',
    when:
      "<b>Cuándo te importa:</b> hay dinero — stake, pozo y payout — y necesitás custodia.",
    acc: "#ffb648",
    rgb: "255,182,72",
    play: "#2a1c05",
    motif: `
      <circle cx="96" cy="103" r="32" fill="none" stroke="#4fe6a8" stroke-width="4"></circle>
      <circle cx="304" cy="103" r="32" fill="#0a0810" stroke="#9d8cff" stroke-width="4"></circle>
      <line x1="128" y1="103" x2="272" y2="103" stroke="#5f5872" stroke-width="2.5" stroke-dasharray="9 8"></line>
      <circle cx="200" cy="103" r="11" fill="#ffcd7a"></circle>
      <text x="200" y="180" fill="#e9e6f2" font-family="'Bricolage Grotesque',sans-serif" font-size="26" font-weight="800" text-anchor="middle">NGE</text>`,
  },
];

// Barra de transporte reutilizable (secciones y pantalla completa).
function transportBar(): string {
  return `
    <button class="tbtn" data-act="reset" title="Volver al inicio" aria-label="Volver al inicio"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="2" width="2" height="10" fill="currentColor"></rect><path d="M12 2L5 7l7 5z" fill="currentColor"></path></svg></button>
    <button class="tbtn" data-act="back" title="Retroceder 1s" aria-label="Retroceder 1 segundo"><svg width="15" height="15" viewBox="0 0 16 14"><path d="M7 2L1 7l6 5z M14 2L8 7l6 5z" fill="currentColor"></path></svg></button>
    <button class="tbtn pp" data-act="toggle" title="Play / pausa (espacio)" aria-label="Play o pausa"><svg width="15" height="15" viewBox="0 0 14 14"><path d="M3 2l9 5-9 5z" fill="currentColor"></path></svg></button>
    <button class="tbtn" data-act="fwd" title="Adelantar 1s" aria-label="Adelantar 1 segundo"><svg width="15" height="15" viewBox="0 0 16 14"><path d="M2 2l6 5-6 5z M9 2l6 5-6 5z" fill="currentColor"></path></svg></button>
    <div class="track" title="Ir a…"><div class="track-bg"></div><div class="fill"></div><div class="knob"></div></div>
    <div class="time"><span class="cur">0:00</span> <span class="sep">/ <span class="dur">0:00</span></span></div>`;
}

function animSection(a: Anim): string {
  return `
  <section class="anim" id="${a.id}" data-key="${a.key}" data-src="${a.src}" data-title="${a.title}" style="--acc:${a.acc};--acc-rgb:${a.rgb};">
    <div class="anim-head">
      <div class="anim-head-main">
        <div class="anim-tags">
          <span class="anim-badge">${a.badge}</span>
          <span class="anim-spec">${a.spec}</span>
        </div>
        <h2 class="anim-title">${a.name}</h2>
        <p class="anim-desc">${a.desc}</p>
      </div>
      <div class="anim-when"><span class="eye">👁</span><span>${a.when}</span></div>
    </div>
    <div class="anim-frame">
      <div class="media">
        <button class="poster an-float" type="button" aria-label="Reproducir ${a.name}">
          <svg class="motif" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid meet">${a.motif}</svg>
          <span class="an-play"><span class="tri" style="border-left-color:${a.play}"></span></span>
          <span class="poster-hint">Play para reproducir</span>
        </button>
        <button class="fs-btn" type="button" hidden>⤢ Pantalla completa</button>
      </div>
      <div class="transport" hidden>${transportBar()}</div>
    </div>
  </section>`;
}

const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; scroll-behavior: smooth; }
  body {
    background:
      radial-gradient(1100px 760px at 82% -12%, rgba(157,140,255,0.16), transparent 58%),
      radial-gradient(820px 620px at 88% 4%, rgba(255,182,72,0.10), transparent 60%),
      radial-gradient(900px 900px at 8% 108%, rgba(79,230,168,0.06), transparent 60%),
      #08070c;
    color: #e9e6f2;
    font-family: 'Geist', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 24px 96px; position: relative; }

  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 52px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
  .brand-mark { width: 34px; height: 34px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #221d30 0%, #0a0810 70%); box-shadow: 0 0 0 1px rgba(157,140,255,0.35), 0 0 22px -4px rgba(255,182,72,0.55); }
  .brand-name { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; color: #e9e6f2; }
  .brand-sub { font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #5f5872; margin-top: 3px; }
  .top-links { display: flex; gap: 22px; font-size: 13.5px; color: #9a93ad; flex-wrap: wrap; }
  .top-links a { text-decoration: none; }
  .top-links a:hover { color: #e9e6f2; }
  .pillbadge { display: flex; align-items: center; gap: 8px; font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #9d8cff; border: 1px solid rgba(157,140,255,0.35); background: rgba(157,140,255,0.08); padding: 6px 12px; border-radius: 999px; }
  .pillbadge .dot { width: 6px; height: 6px; border-radius: 50%; background: #9d8cff; box-shadow: 0 0 8px #9d8cff; }

  .hero { max-width: 820px; margin-bottom: 20px; }
  .eyebrow { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #9d8cff; margin-bottom: 18px; }
  h1 { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: clamp(36px, 5.6vw, 60px); line-height: 1; letter-spacing: -0.03em; margin: 0 0 22px; }
  h1 .accent { color: #9d8cff; }
  .lead { font-size: 18px; line-height: 1.6; color: #cfc8de; margin: 0 0 8px; max-width: 680px; text-wrap: pretty; }
  .lead strong { color: #e9e6f2; font-weight: 600; }
  .lead .dim { color: #7a7290; }

  .chips { display: flex; gap: 9px; margin-bottom: 34px; flex-wrap: wrap; }
  .chip { text-decoration: none; font-family: 'Geist Mono', monospace; font-size: 12px; letter-spacing: 0.04em; padding: 8px 14px; border-radius: 999px; }
  .chip.luna { color: #c2b5ff; background: rgba(157,140,255,0.1); border: 1px solid rgba(157,140,255,0.32); }
  .chip.aurora { color: #84f3c6; background: rgba(79,230,168,0.1); border: 1px solid rgba(79,230,168,0.32); }
  .chip.corona { color: #ffcd7a; background: rgba(255,182,72,0.1); border: 1px solid rgba(255,182,72,0.32); }

  .anims { display: flex; flex-direction: column; gap: 56px; }
  .anim { scroll-margin-top: 24px; }
  .anim-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
  .anim-head-main { max-width: 660px; }
  .anim-tags { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .anim-badge { font-family: 'Geist Mono', monospace; font-weight: 600; font-size: 12.5px; padding: 5px 11px; border-radius: 8px; background: rgba(var(--acc-rgb),0.14); color: var(--acc); border: 1px solid var(--acc); }
  .anim-spec { font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #5f5872; }
  .anim-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 32px; letter-spacing: -0.02em; margin: 0 0 10px; }
  .anim-desc { font-size: 15.5px; line-height: 1.6; color: #cfc8de; margin: 0; text-wrap: pretty; }
  .anim-desc strong { color: #e9e6f2; font-weight: 600; }
  .anim-desc em { font-style: normal; color: #e9e6f2; }
  .anim-when { display: flex; align-items: center; gap: 9px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: var(--acc); background: rgba(var(--acc-rgb),0.08); border: 1px solid rgba(var(--acc-rgb),0.24); padding: 9px 14px; border-radius: 12px; max-width: 340px; line-height: 1.45; }
  .anim-when .eye { font-size: 14px; }
  .anim-when b { font-weight: 600; }

  .anim-frame { border-radius: 22px; overflow: hidden; border: 1px solid rgba(var(--acc-rgb),0.3); box-shadow: 0 40px 100px -44px rgba(var(--acc-rgb),0.36), 0 30px 80px -50px rgba(0,0,0,0.9); background: #050409; }
  .media { position: relative; aspect-ratio: 16 / 9; width: 100%; }
  .anim-iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #050409; }
  .poster { display: block; width: 100%; height: 100%; border: 0; cursor: pointer; padding: 0; position: relative; background: radial-gradient(120% 120% at 50% 42%, rgba(var(--acc-rgb),0.13), transparent 62%), #050409; }
  .poster .motif { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.9; }
  .an-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 74px; height: 74px; border-radius: 50%; background: rgba(var(--acc-rgb),0.93); display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 40px -8px rgba(var(--acc-rgb),0.65); animation: an-pulse 2.6s ease-out infinite; }
  .an-play .tri { width: 0; height: 0; border-left: 22px solid #14102a; border-top: 13px solid transparent; border-bottom: 13px solid transparent; margin-left: 6px; }
  .poster-hint { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a7290; }

  .fs-btn { position: absolute; top: 14px; right: 14px; z-index: 2; cursor: pointer; font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--acc); background: rgba(10,8,16,0.82); border: 1px solid rgba(var(--acc-rgb),0.42); padding: 7px 13px; border-radius: 9px; backdrop-filter: blur(6px); }

  .anim-fail { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; padding: 28px; background: radial-gradient(120% 120% at 50% 42%, rgba(var(--acc-rgb),0.1), transparent 62%), #050409; }
  .anim-fail .fic { font-size: 26px; opacity: 0.85; }
  .anim-fail p { font-size: 14px; line-height: 1.55; color: #cfc8de; margin: 0; max-width: 440px; }
  .anim-fail p b { color: #e9e6f2; font-weight: 600; }
  .anim-fail .fail-retry { cursor: pointer; font-family: 'Geist Mono', monospace; font-size: 11.5px; letter-spacing: 0.06em; color: var(--acc); background: rgba(var(--acc-rgb),0.14); border: 1px solid rgba(var(--acc-rgb),0.42); padding: 9px 16px; border-radius: 10px; }
  .anim-fail .fail-retry:hover { background: rgba(var(--acc-rgb),0.22); }

  .transport { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-top: 1px solid rgba(var(--acc-rgb),0.16); background: rgba(12,9,20,0.75); }
  .transport[hidden] { display: none; }
  .tbtn { cursor: pointer; width: 34px; height: 34px; border-radius: 9px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--acc); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .15s, border-color .15s; }
  .tbtn:hover { background: rgba(255,255,255,0.09); border-color: rgba(var(--acc-rgb),0.4); }
  .tbtn.pp { width: 42px; height: 42px; border-radius: 50%; background: rgba(var(--acc-rgb),0.16); border: 1px solid rgba(var(--acc-rgb),0.45); color: #e9e6f2; }
  .track { flex: 1; height: 22px; position: relative; cursor: pointer; display: flex; align-items: center; }
  .track-bg { position: absolute; left: 0; right: 0; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.12); }
  .fill { position: absolute; left: 0; width: 0%; height: 5px; border-radius: 3px; background: var(--acc); }
  .knob { position: absolute; top: 50%; left: 0%; width: 13px; height: 13px; margin-left: -6px; margin-top: -6px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.5); }
  .time { font-family: 'Geist Mono', monospace; font-size: 11.5px; font-variant-numeric: tabular-nums; color: #9a93ad; flex-shrink: 0; white-space: nowrap; }
  .time .sep { color: #5f5872; }

  .note { display: flex; gap: 12px; padding: 16px 20px; border-radius: 16px; align-items: flex-start; }
  .note.kbd { margin-top: 56px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); }
  .note.kbd p { font-size: 13px; line-height: 1.6; color: #9a93ad; margin: 0; max-width: 820px; }
  .note.kbd b { color: #cfc8de; font-weight: 600; }
  .note.back { margin-top: 16px; background: rgba(157,140,255,0.06); border: 1px solid rgba(157,140,255,0.2); }
  .note.back p { font-size: 13.5px; line-height: 1.6; color: #cfc8de; margin: 0; max-width: 820px; }
  .note.back a { color: #c2b5ff; text-decoration: underline; text-underline-offset: 2px; }
  .note.back strong { color: #e9e6f2; font-weight: 600; }
  .note .ic { font-size: 15px; line-height: 1.3; }

  footer.foot { border-top: 1px solid rgba(255,255,255,0.06); margin-top: 40px; padding-top: 22px; display: flex; gap: 12px; align-items: flex-start; }
  footer.foot p { font-size: 12.5px; line-height: 1.6; color: #5f5872; margin: 0; max-width: 820px; }
  footer.foot a { color: #9a93ad; text-decoration: underline; text-underline-offset: 2px; }

  /* Pantalla completa */
  .fs { position: fixed; inset: 0; z-index: 9999; background: rgba(5,4,9,0.94); backdrop-filter: blur(8px); display: none; flex-direction: column; padding: 20px; }
  .fs.open { display: flex; }
  .fs-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .fs-title { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a93ad; }
  .fs-close { cursor: pointer; font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #e9e6f2; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); padding: 8px 14px; border-radius: 9px; }
  .fs-body { flex: 1; min-height: 0; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); background: #050409; display: flex; flex-direction: column; --acc: #9d8cff; --acc-rgb: 157,140,255; }
  .fs-body iframe { flex: 1; min-height: 0; width: 100%; border: 0; display: block; background: #050409; }
  .fs-body .transport { border-top: 1px solid rgba(255,255,255,0.1); background: rgba(12,9,20,0.85); padding: 12px 18px; }

  @keyframes an-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  @keyframes an-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes an-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.18); } 60% { box-shadow: 0 0 0 18px rgba(255,255,255,0); } }
  .an-float { animation: an-float 6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .an-orbit, .an-float, .an-play { animation: none !important; } }

  @media (max-width: 640px) {
    .anim-when { max-width: none; }
    .time .sep { display: none; }
  }
`;

const BODY = `
<div class="wrap">

  <header class="topbar">
    <a class="brand" href="/">
      <span class="brand-mark"></span>
      <span style="display:flex;flex-direction:column;line-height:1;">
        <span class="brand-name">Luna Negra</span>
        <span class="brand-sub">Guía del desarrollador</span>
      </span>
    </a>
    <nav class="top-links">
      <a href="/dev">Guía NGP</a>
      <a href="/dev#niveles">Niveles</a>
      <a href="/dev#kinds">Kinds</a>
      <a href="/dev/luna">Versión REST 1.0</a>
    </nav>
    <div class="pillbadge"><span class="dot"></span>3 animaciones</div>
  </header>

  <section class="hero">
    <div class="eyebrow">Animaciones · los protocolos en movimiento</div>
    <h1>Mirá cómo se mueven<br><span class="accent">los tres protocolos.</span></h1>
    <p class="lead">La guía te da el texto y el código. Estas animaciones te dan la <strong>intuición</strong>: quién firma, qué viaja por dónde y quién lo lee. Cada una explica <strong>un</strong> protocolo. <span class="dim">Se cargan recién al darle play; después las pausás, adelantás y retrocedés con la barra.</span></p>
  </section>

  <nav class="chips">
    <a class="chip luna" href="#ngp">NGP · eventos públicos</a>
    <a class="chip aurora" href="#room-link">Room Link · invitaciones</a>
    <a class="chip corona" href="#nge">NGE · escrow</a>
  </nav>

  <div class="anims">
    ${ANIMS.map(animSection).join("\n")}
  </div>

  <section class="note kbd">
    <span class="ic">⌨</span>
    <p>Controlá cada animación con la barra —volver al inicio, ±1s, play/pausa y scrub— o con el teclado sobre la animación enfocada: <b>espacio</b> play/pausa, <b>← →</b> mueven 0,1s (con Shift, 1s), <b>0</b> vuelve al inicio.</p>
  </section>

  <section class="note back">
    <span class="ic">↩</span>
    <p>¿Preferís el texto y el código? Volvé a la <a href="/dev">guía del desarrollador</a>. NGP es la capa pública, <strong>Room Link</strong> el estándar de invitación y <strong>NGE</strong> el canal de escrow — las tres se apilan.</p>
  </section>

  <footer class="foot">
    <span class="ic">⚠️</span>
    <p>Las animaciones son autocontenidas y se cargan solo al darle play. Los controles no modifican su contenido: manejan la reproducción desde afuera. Son un apoyo visual a los mismos protocolos que <a href="/dev">/dev</a> explica con eventos Nostr y código.</p>
  </footer>

</div>

<div class="fs" id="fs" aria-hidden="true">
  <div class="fs-top">
    <span class="fs-title" id="fs-title"></span>
    <button class="fs-close" id="fs-close" type="button">Cerrar ✕</button>
  </div>
  <div class="fs-body">
    <iframe id="fs-iframe" title="Animación en pantalla completa"></iframe>
    <div class="transport" id="fs-transport">${transportBar()}</div>
  </div>
</div>
`;

const SCRIPT = `
(function () {
  var ICON_PLAY = '<svg width="15" height="15" viewBox="0 0 14 14"><path d="M3 2l9 5-9 5z" fill="currentColor"></path></svg>';
  var ICON_PAUSE = '<svg width="15" height="15" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor"></rect><rect x="8" y="2" width="3" height="10" fill="currentColor"></rect></svg>';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }
  function fmt(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + ("" + s).padStart(2, "0"); }

  // Lee el estado real de una animación desde su iframe (mismo origen).
  function ctl(frame) {
    if (!frame) return null;
    try {
      var win = frame.contentWindow, doc = frame.contentDocument;
      if (!doc) return null;
      var svg = doc.querySelector("svg[data-om-exportable-video-with-duration-secs]");
      if (!svg) return null;
      var dur = parseFloat(svg.getAttribute("data-om-exportable-video-with-duration-secs")) || 0;
      var t = 0, chrome = doc.querySelector("[data-omelette-chrome]");
      if (chrome) {
        var m = chrome.textContent.match(/(\\d+):(\\d\\d)\\.(\\d\\d)/);
        if (m) t = (+m[1]) * 60 + (+m[2]) + (+m[3]) / 100;
      }
      return { win: win, doc: doc, svg: svg, dur: dur, t: t };
    } catch (e) { return null; }
  }

  // Oculta la barra gris propia del motor de animación (presentación, no contenido).
  function hideChrome(frame) {
    try {
      var doc = frame.contentDocument;
      if (!doc || doc.getElementById("__om_hidechrome")) return;
      var st = doc.createElement("style");
      st.id = "__om_hidechrome";
      st.textContent = "[data-omelette-chrome]{display:none!important}";
      (doc.head || doc.documentElement).appendChild(st);
    } catch (e) {}
  }

  // Un controlador maneja un iframe a través de una barra de transporte (los
  // elementos de UI). Usa los hooks documentados del motor: evento de seek en
  // el <svg> y tecla espacio para play/pausa.
  function makeController(getFrame, tp) {
    var ui = {
      pp: tp.querySelector(".pp"),
      fill: tp.querySelector(".fill"),
      knob: tp.querySelector(".knob"),
      track: tp.querySelector(".track"),
      cur: tp.querySelector(".cur"),
      dur: tp.querySelector(".dur"),
    };
    var playing = false, last = null;

    function seek(time, resume) {
      var c = ctl(getFrame());
      if (!c) return;
      var t = clamp(time, 0, c.dur || time);
      c.svg.dispatchEvent(new c.win.CustomEvent("data-om-seek-to-time-frame", { detail: { time: t } }));
      if (resume) setTimeout(function () {
        var c2 = ctl(getFrame());
        if (c2) c2.win.dispatchEvent(new c2.win.KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
      }, 45);
    }
    function toggle() {
      var c = ctl(getFrame());
      if (!c) return;
      c.win.dispatchEvent(new c.win.KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    }
    function skip(d) {
      var c = ctl(getFrame());
      if (!c) return;
      seek(c.t + d, playing);
    }
    function scrubX(clientX) {
      var c = ctl(getFrame());
      if (!c) return;
      var r = ui.track.getBoundingClientRect();
      var frac = clamp((clientX - r.left) / r.width, 0, 1);
      seek(frac * c.dur, playing);
    }
    function tick() {
      var c = ctl(getFrame());
      if (!c) return;
      playing = last != null && Math.abs(c.t - last) > 0.0005;
      last = c.t;
      var pct = c.dur > 0 ? (c.t / c.dur * 100) : 0;
      ui.fill.style.width = pct + "%";
      ui.knob.style.left = pct + "%";
      ui.cur.textContent = fmt(c.t);
      ui.dur.textContent = fmt(c.dur);
      ui.pp.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    }

    tp.querySelector('[data-act="reset"]').addEventListener("click", function () { seek(0, false); });
    tp.querySelector('[data-act="back"]').addEventListener("click", function () { skip(-1); });
    tp.querySelector('[data-act="toggle"]').addEventListener("click", toggle);
    tp.querySelector('[data-act="fwd"]').addEventListener("click", function () { skip(1); });

    var dragging = false;
    ui.track.addEventListener("mousedown", function (e) { dragging = true; scrubX(e.clientX); e.preventDefault(); });
    window.addEventListener("mousemove", function (e) { if (dragging) scrubX(e.clientX); });
    window.addEventListener("mouseup", function () { dragging = false; });

    return { tick: tick, reset: function () { last = null; playing = false; ui.pp.innerHTML = ICON_PLAY; ui.fill.style.width = "0%"; ui.knob.style.left = "0%"; } };
  }

  // ── Pantalla completa ─────────────────────────────────────────────────────
  var fs = document.getElementById("fs");
  var fsFrame = document.getElementById("fs-iframe");
  var fsCtrl = makeController(function () { return fsFrame; }, document.getElementById("fs-transport"));
  var fsIv = null;
  function openFs(src, title) {
    document.getElementById("fs-title").textContent = title;
    fsCtrl.reset();
    fsFrame.onload = function () { hideChrome(fsFrame); };
    fsFrame.src = src;
    fs.classList.add("open");
    fs.setAttribute("aria-hidden", "false");
    fsIv = setInterval(fsCtrl.tick, 140);
  }
  function closeFs() {
    fs.classList.remove("open");
    fs.setAttribute("aria-hidden", "true");
    if (fsIv) { clearInterval(fsIv); fsIv = null; }
    fsFrame.removeAttribute("src");
  }
  document.getElementById("fs-close").addEventListener("click", closeFs);
  fs.addEventListener("click", function (e) { if (e.target === fs) closeFs(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && fs.classList.contains("open")) closeFs(); });

  // ── Cada sección de animación ─────────────────────────────────────────────
  document.querySelectorAll(".anim").forEach(function (sec) {
    var src = sec.getAttribute("data-src");
    var title = sec.getAttribute("data-title");
    var media = sec.querySelector(".media");
    var poster = sec.querySelector(".poster");
    var fsBtn = sec.querySelector(".fs-btn");
    var transport = sec.querySelector(".transport");
    var frame = null, tickIv = null, watchdog = null;

    // Muestra un aviso legible si la animación no expone su motor tras cargar
    // (p. ej. un export sin la escena embebida): mejor que un cuadro en negro.
    function showFail() {
      if (media.querySelector(".anim-fail")) return;
      if (tickIv) { clearInterval(tickIv); tickIv = null; }
      transport.hidden = true;
      fsBtn.hidden = true;
      var box = document.createElement("div");
      box.className = "anim-fail";
      box.innerHTML =
        '<span class="fic">🎞️</span>' +
        '<p><b>No se pudo cargar esta animación.</b> El archivo no expone su motor de reproducción. Si acabás de actualizarlo, reintentá; si persiste, hay que volver a exportar la animación.</p>' +
        '<button class="fail-retry" type="button">Reintentar</button>';
      box.querySelector(".fail-retry").addEventListener("click", teardown);
      media.appendChild(box);
    }

    // Reinicia la tarjeta al póster para poder volver a intentar.
    function teardown() {
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
      if (tickIv) { clearInterval(tickIv); tickIv = null; }
      var fail = media.querySelector(".anim-fail");
      if (fail) fail.remove();
      if (frame) { frame.remove(); frame = null; }
      poster.style.display = "";
      transport.hidden = true;
      fsBtn.hidden = true;
    }

    poster.addEventListener("click", function () {
      if (frame) return;
      frame = document.createElement("iframe");
      frame.className = "anim-iframe";
      frame.title = "Animación " + title;
      frame.setAttribute("loading", "lazy");
      frame.addEventListener("load", function () { hideChrome(frame); });
      frame.src = src;
      media.insertBefore(frame, poster);
      poster.style.display = "none";
      fsBtn.hidden = false;
      transport.hidden = false;
      var ctrl = makeController(function () { return frame; }, transport);
      tickIv = setInterval(ctrl.tick, 140);

      // Watchdog: el motor debería exponer su hook de seek en pocos segundos.
      var checks = 0;
      watchdog = setInterval(function () {
        checks++;
        if (ctl(frame)) { clearInterval(watchdog); watchdog = null; return; }
        if (checks >= 32) { clearInterval(watchdog); watchdog = null; showFail(); }
      }, 250);
    });

    fsBtn.addEventListener("click", function () { openFs(src, title); });
  });
})();
`;

function doc(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Animaciones de los protocolos de Luna Negra: NGP (eventos Nostr públicos), Luna Room Link (invitación a salas) y NGE (canal de escrow cifrado). Apoyo visual a la guía del desarrollador." />
<title>Luna Negra · Animaciones de los protocolos (NGP · Room Link · NGE)</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body>
</html>`;
}

export function GET() {
  return new Response(doc(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
