// Guia autocontenida para desarrolladores. No participa del layout de la app:
// sirve HTML estatico con CSS inline para que funcione como documento publico
// aun sin cargar el bundle principal.

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Guia para entender e integrar juegos con Luna Negra: login Nostr, pagos Lightning, salas, presencia, apuestas, webhooks y SDK."
    />
    <title>Luna Negra &middot; Guia para equipos y developers</title>
    <style>
      :root {
        --bg: #080b11;
        --bg-2: #0e141c;
        --panel: #121a24;
        --panel-2: #182331;
        --panel-3: #213044;
        --line: rgba(255, 255, 255, 0.08);
        --line-2: rgba(255, 255, 255, 0.15);
        --ink: #d8e3ed;
        --white: #ffffff;
        --muted: #8ea0b2;
        --faint: #617183;
        --blue: #66c0f4;
        --blue-hi: #a7dbff;
        --blue-soft: rgba(102, 192, 244, 0.12);
        --btc: #f7931a;
        --btc-hi: #ffb54a;
        --btc-soft: rgba(247, 147, 26, 0.13);
        --green: #a1cd44;
        --green-soft: rgba(161, 205, 68, 0.12);
        --danger: #e06a5b;
        --code: #080d14;
      }

      * { box-sizing: border-box; }
      html {
        overflow-x: hidden;
        scroll-behavior: smooth;
      }
      body {
        margin: 0;
        min-height: 100vh;
        overflow-x: hidden;
        background:
          linear-gradient(125deg, rgba(28, 86, 128, 0.24) 0%, rgba(18, 42, 68, 0.08) 28%, transparent 54%),
          linear-gradient(180deg, #080b11 0%, #0e141c 42%, #080b11 100%);
        color: var(--ink);
        font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background:
          linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
          linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: linear-gradient(180deg, black 0%, rgba(0, 0, 0, 0.72) 44%, transparent 100%);
      }
      a { color: var(--blue-hi); text-decoration: none; }
      a:hover { color: var(--white); text-decoration: underline; text-underline-offset: 3px; }
      code {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.24);
        color: #f4f8fb;
        padding: 0.12rem 0.32rem;
        font: 0.9em/1.5 ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace;
      }
      pre {
        margin: 0;
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 7px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 34%),
          var(--code);
        padding: 18px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      pre code {
        display: block;
        border: 0;
        background: transparent;
        color: #d9e8f5;
        padding: 0;
        white-space: pre;
      }
      table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 12px 10px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      td:first-child, th:first-child { padding-left: 0; }
      td:last-child, th:last-child { padding-right: 0; }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        border-bottom: 1px solid #05080c;
        background: rgba(8, 11, 17, 0.86);
        backdrop-filter: blur(14px);
      }
      .topbar-inner {
        display: flex;
        align-items: center;
        gap: 18px;
        width: min(1180px, calc(100% - 32px));
        height: 64px;
        margin: 0 auto;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--white);
        font-weight: 800;
        letter-spacing: 0;
        white-space: nowrap;
      }
      .brand-mark {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid rgba(102, 192, 244, 0.42);
        border-radius: 6px;
        background: linear-gradient(135deg, #132132, #0b111a);
        color: var(--blue);
        font: 800 13px/1 ui-monospace, "Cascadia Code", monospace;
      }
      .top-links {
        display: flex;
        min-width: 0;
        flex: 1;
        gap: 6px;
        overflow-x: auto;
        scrollbar-width: none;
        white-space: nowrap;
      }
      .top-links::-webkit-scrollbar { display: none; }
      .top-links a {
        border-radius: 4px;
        color: #b8c6d4;
        padding: 7px 10px;
        font-size: 0.75rem;
        font-weight: 700;
        text-decoration: none;
        text-transform: uppercase;
      }
      .top-links a:hover { background: rgba(255, 255, 255, 0.08); color: var(--white); }
      .top-action {
        flex: 0 0 auto;
        border-radius: 4px;
        background: linear-gradient(95deg, #3aa3e0 0%, #1c63ab 100%);
        color: #eef9ff;
        padding: 9px 13px;
        font-size: 0.86rem;
        font-weight: 800;
        text-decoration: none;
        box-shadow: 0 12px 22px -18px rgba(102, 192, 244, 0.7);
      }
      .top-action:hover { text-decoration: none; color: var(--white); }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
        gap: 28px;
        align-items: start;
        padding: 56px 0 34px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--blue-hi);
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
      }
      .eyebrow::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: var(--green);
        box-shadow: 0 0 0 4px var(--green-soft);
      }
      h1 {
        margin: 14px 0 16px;
        max-width: 780px;
        color: var(--white);
        font-size: clamp(2.25rem, 6vw, 5.7rem);
        line-height: 0.95;
        letter-spacing: 0;
      }
      .lead {
        max-width: 760px;
        margin: 0;
        color: #b7c8d8;
        font-size: clamp(1rem, 1.5vw, 1.22rem);
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 24px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        border: 1px solid var(--line-2);
        border-radius: 4px;
        padding: 10px 14px;
        color: var(--ink);
        font-size: 0.9rem;
        font-weight: 800;
        text-decoration: none;
      }
      .button:hover { text-decoration: none; color: var(--white); background: rgba(255, 255, 255, 0.07); }
      .button.primary {
        border-color: transparent;
        background: linear-gradient(95deg, #fba52e 0%, #e07f12 100%);
        color: #231304;
      }
      .button.primary:hover { color: #120902; background: linear-gradient(95deg, #ffb54a 0%, #f18a18 100%); }
      .signal-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 28px;
      }
      .signal {
        min-height: 88px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(18, 26, 36, 0.78);
        padding: 14px;
      }
      .signal strong {
        display: block;
        color: var(--white);
        font-size: 1.05rem;
        line-height: 1.1;
      }
      .signal span {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.86rem;
        line-height: 1.35;
      }
      .flow-panel {
        border: 1px solid var(--line-2);
        border-radius: 8px;
        background:
          linear-gradient(180deg, rgba(102, 192, 244, 0.1), transparent 38%),
          rgba(18, 26, 36, 0.9);
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
        padding: 18px;
      }
      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid var(--line);
        padding-bottom: 14px;
      }
      .panel-head strong { color: var(--white); font-size: 1rem; }
      .status {
        border: 1px solid rgba(161, 205, 68, 0.36);
        border-radius: 999px;
        background: var(--green-soft);
        color: #d8f7a2;
        padding: 4px 9px;
        font-size: 0.72rem;
        font-weight: 800;
      }
      .flow {
        display: grid;
        gap: 10px;
        margin: 16px 0 0;
      }
      .flow-step {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.16);
        padding: 12px;
      }
      .flow-step b {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 5px;
        background: var(--blue-soft);
        color: var(--blue-hi);
        font: 800 0.82rem/1 ui-monospace, "Cascadia Code", monospace;
      }
      .flow-step strong { display: block; color: var(--white); line-height: 1.2; }
      .flow-step span { display: block; margin-top: 4px; color: var(--muted); font-size: 0.88rem; line-height: 1.4; }
      .quick-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 0 0 34px;
      }
      .quick-card {
        display: flex;
        min-height: 118px;
        flex-direction: column;
        justify-content: space-between;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.78);
        padding: 16px;
        text-decoration: none;
      }
      .quick-card:hover {
        border-color: rgba(102, 192, 244, 0.38);
        background: rgba(24, 35, 49, 0.92);
        text-decoration: none;
      }
      .quick-card strong { color: var(--white); font-size: 1rem; }
      .quick-card span { color: var(--muted); font-size: 0.88rem; line-height: 1.35; }
      .quick-card em { color: var(--blue-hi); font-style: normal; font-weight: 800; }
      .audience-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 0 0 34px;
      }
      .audience-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.78);
        padding: 18px;
      }
      .audience-card strong {
        display: block;
        color: var(--white);
        font-size: 1.05rem;
      }
      .audience-card p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.94rem;
      }
      .audience-card ul {
        display: grid;
        gap: 8px;
        margin: 14px 0 0;
        padding: 0;
        list-style: none;
      }
      .audience-card li {
        border-left: 3px solid var(--blue);
        color: #bdcad7;
        padding-left: 10px;
        font-size: 0.9rem;
        line-height: 1.38;
      }

      .content {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        gap: 28px;
        align-items: start;
        padding-bottom: 80px;
      }
      .content,
      .article,
      section,
      .toc {
        min-width: 0;
      }
      .toc {
        position: sticky;
        top: 88px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.72);
        padding: 12px;
      }
      .toc strong {
        display: block;
        color: var(--white);
        font-size: 0.78rem;
        text-transform: uppercase;
        margin: 4px 8px 8px;
      }
      .toc a {
        display: block;
        border-radius: 4px;
        color: var(--muted);
        min-width: 0;
        overflow-wrap: anywhere;
        padding: 7px 8px;
        font-size: 0.88rem;
        text-decoration: none;
      }
      .toc a:hover { background: rgba(255, 255, 255, 0.06); color: var(--white); }
      .article {
        display: grid;
        gap: 16px;
      }
      section {
        scroll-margin-top: 88px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.74);
        padding: clamp(20px, 4vw, 30px);
      }
      section h2 {
        margin: 0;
        color: var(--white);
        font-size: clamp(1.45rem, 3vw, 2rem);
        line-height: 1.1;
        letter-spacing: 0;
      }
      section h3 {
        margin: 22px 0 8px;
        color: var(--blue-hi);
        font-size: 1.03rem;
      }
      section p {
        margin: 12px 0 0;
        color: #bdcad7;
      }
      .section-lead {
        max-width: 850px;
        color: var(--muted);
        font-size: 1rem;
      }
      .two-col {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 0.9fr);
        gap: 16px;
        align-items: start;
        margin-top: 18px;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      .explain-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      .explain {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.16);
        padding: 14px;
      }
      .explain strong {
        display: block;
        color: var(--white);
        font-size: 0.95rem;
      }
      .explain span {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.42;
      }
      .mini-card {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.16);
        padding: 14px;
      }
      .mini-card.money { border-color: rgba(247, 147, 26, 0.32); background: var(--btc-soft); }
      .mini-card.ok { border-color: rgba(161, 205, 68, 0.28); background: var(--green-soft); }
      .mini-card.info { border-color: rgba(102, 192, 244, 0.32); background: var(--blue-soft); }
      .mini-card strong { display: block; color: var(--white); line-height: 1.2; }
      .mini-card span { display: block; margin-top: 7px; color: var(--muted); font-size: 0.9rem; line-height: 1.42; }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        border-radius: 999px;
        background: var(--blue-soft);
        color: var(--blue-hi);
        padding: 3px 8px;
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
        vertical-align: middle;
      }
      .badge.money { background: var(--btc-soft); color: var(--btc-hi); }
      .badge.ok { background: var(--green-soft); color: #d8f7a2; }
      .timeline {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .timeline-item {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.16);
        padding: 14px;
      }
      .timeline-item b {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 5px;
        background: var(--btc-soft);
        color: var(--btc-hi);
        font: 800 0.75rem/1 ui-monospace, "Cascadia Code", monospace;
      }
      .timeline-item strong { display: block; margin-top: 10px; color: var(--white); }
      .timeline-item span { display: block; margin-top: 6px; color: var(--muted); font-size: 0.9rem; line-height: 1.42; }
      .note {
        border: 1px solid rgba(247, 147, 26, 0.26);
        border-left: 4px solid var(--btc);
        border-radius: 7px;
        background: rgba(247, 147, 26, 0.09);
        color: #f6d9ad;
        padding: 13px 14px;
      }
      .note strong { color: #ffe0b4; }
      .note.danger {
        border-color: rgba(224, 106, 91, 0.3);
        border-left-color: var(--danger);
        background: rgba(224, 106, 91, 0.1);
        color: #f1b8b1;
      }
      .endpoint-table { margin-top: 18px; overflow-x: auto; }
      .method {
        display: inline-flex;
        min-width: 48px;
        justify-content: center;
        border-radius: 4px;
        background: var(--blue-soft);
        color: var(--blue-hi);
        padding: 2px 6px;
        font: 800 0.72rem/1.5 ui-monospace, "Cascadia Code", monospace;
      }
      .method.post { background: var(--green-soft); color: #d8f7a2; }
      .method.money { background: var(--btc-soft); color: var(--btc-hi); }
      .footer {
        border-top: 1px solid var(--line);
        color: var(--muted);
        padding: 24px 0 48px;
        text-align: center;
      }

      .cmd { position: relative; }
      .cmd pre { padding-right: 92px; }
      .copy-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--line-2);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--ink);
        padding: 6px 10px;
        font: 800 0.74rem/1 ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .copy-btn:hover { background: rgba(255, 255, 255, 0.12); color: var(--white); }
      .copy-btn.done { border-color: rgba(161, 205, 68, 0.5); background: var(--green-soft); color: #d8f7a2; }
      .install-cta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-top: 18px;
        border: 1px solid rgba(247, 147, 26, 0.3);
        border-radius: 8px;
        background: var(--btc-soft);
        padding: 16px;
      }
      .install-cta strong { color: var(--white); }
      .install-cta span { color: var(--muted); font-size: 0.9rem; }
      .install-cta .button { margin-left: auto; }
      .install-hero {
        margin-top: 18px;
        border: 1px solid rgba(102, 192, 244, 0.4);
        border-radius: 9px;
        background:
          linear-gradient(180deg, rgba(102, 192, 244, 0.12), transparent 40%),
          rgba(18, 26, 36, 0.9);
        padding: 18px;
      }
      .install-hero .step-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--blue-hi);
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
      }
      .install-hero h3 { margin: 8px 0 4px; color: var(--white); }
      .install-hero .cmd pre { font-size: 0.95rem; }
      .install-hero .hint { margin: 12px 0 0; color: var(--muted); font-size: 0.9rem; }

      @media (max-width: 980px) {
        .hero,
        .content,
        .two-col { grid-template-columns: 1fr; }
        .toc { position: static; order: -1; }
        .toc nav {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 4px;
        }
        .flow-panel { max-width: none; }
      }
      @media (max-width: 720px) {
        .topbar-inner { width: min(100% - 24px, 1180px); gap: 10px; }
        .brand span:last-child { display: none; }
        .top-links {
          justify-content: flex-end;
          overflow: hidden;
        }
        .top-links a {
          display: none;
          padding: 7px 8px;
          font-size: 0.7rem;
        }
        .top-links a:nth-child(1),
        .top-links a:nth-child(2) { display: block; }
        .top-action {
          display: inline-flex;
          padding: 8px 9px;
          font-size: 0.72rem;
        }
        .shell { width: min(100% - 24px, 1180px); }
        .hero { padding-top: 34px; }
        .signal-row,
        .quick-grid,
        .audience-grid,
        .card-grid,
        .explain-grid,
        .timeline { grid-template-columns: 1fr; }
        section { padding: 18px; }
        table { table-layout: fixed; }
        td,
        th,
        td code {
          overflow-wrap: anywhere;
        }
        th, td { padding: 10px 8px; }
        .toc nav { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" aria-label="Volver a Luna Negra">
          <span class="brand-mark">LN</span>
          <span>Luna Negra</span>
        </a>
        <nav class="top-links" aria-label="Navegacion principal">
          <a href="#inicio">Inicio</a>
          <a href="#conceptos">Conceptos</a>
          <a href="#credenciales">Credenciales</a>
          <a href="#sso">SSO</a>
          <a href="#apuestas">Apuestas</a>
          <a href="#multijugador">Multijugador</a>
          <a href="#webhooks">Webhooks</a>
          <a href="#sdk">SDK</a>
          <a href="#skill">Skill IA</a>
        </nav>
        <a class="top-action" href="#skill">Instalar skill</a>
      </div>
    </header>

    <main id="inicio" class="shell">
      <div class="hero">
        <div>
          <span class="eyebrow">Guia para equipos y developers</span>
          <h1>Publica tu juego y conecta login, pagos y multijugador.</h1>
          <p class="lead">
            Esta pagina explica que resuelve Luna Negra en lenguaje simple y tambien
            deja el detalle tecnico para implementarlo. Si no programas, usala para
            entender el flujo. Si programas, usala como mapa antes de abrir OpenAPI.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="/provider">Crear juego</a>
            <a class="button" href="#skill">Instalar skill para tu IA</a>
            <a class="button" href="/developers">Abrir referencia interactiva</a>
            <a class="button" href="/openapi.json">Ver OpenAPI</a>
          </div>
          <div class="signal-row" aria-label="Capacidades principales">
            <div class="signal"><strong>Login sin cuentas nuevas</strong><span>El jugador entra con su identidad Nostr y tu juego recibe quien es.</span></div>
            <div class="signal"><strong>Pagos y apuestas</strong><span>Luna Negra cobra, custodia pozos en sats y liquida pagos.</span></div>
            <div class="signal"><strong>Social y salas</strong><span>Invites, presencia, amigos y estado compartido para partidas simples.</span></div>
          </div>
        </div>

        <aside class="flow-panel" aria-label="Flujo recomendado de integracion">
          <div class="panel-head">
            <strong>Camino de integracion</strong>
            <span class="status">API v1 estable</span>
          </div>
          <div class="flow">
            <div class="flow-step">
              <b>01</b>
              <div><strong>Publica el juego</strong><span>Desde <a href="/provider">/provider</a> cargas datos, precio, imagenes y la URL donde vive tu juego.</span></div>
            </div>
            <div class="flow-step">
              <b>02</b>
              <div><strong>Reconoce al jugador</strong><span>Luna Negra abre tu juego con un pase temporal. Tu juego lo cambia por la identidad del jugador.</span></div>
            </div>
            <div class="flow-step">
              <b>03</b>
              <div><strong>Activa funciones</strong><span>Agrega presencia, salas, apuestas, marcadores y webhooks segun lo que necesite tu juego.</span></div>
            </div>
          </div>
        </aside>
      </div>

      <div class="quick-grid">
        <a class="quick-card" href="/developers">
          <strong>Referencia interactiva</strong>
          <span>Para developers: prueba endpoints contra tu entorno desde el navegador.</span>
          <em>Abrir /developers &rarr;</em>
        </a>
        <a class="quick-card" href="/openapi.json">
          <strong>Contrato OpenAPI</strong>
          <span>Para integraciones: schemas, rutas y respuestas en formato machine-readable.</span>
          <em>Ver /openapi.json &rarr;</em>
        </a>
        <a class="quick-card" href="#skill">
          <strong>Skill para tu IA</strong>
          <span>Para vibe coders: instala el conocimiento de Luna Negra en Claude Code, Codex u otro agente y deja que integre tu juego.</span>
          <em>Instalar skill &rarr;</em>
        </a>
      </div>

      <div class="audience-grid" aria-label="Como leer esta guia">
        <div class="audience-card">
          <strong>Si no programas</strong>
          <p>Lee los bloques "en simple" para entender que parte de la experiencia cubre Luna Negra.</p>
          <ul>
            <li>Quien es el jugador y si puede jugar.</li>
            <li>Como se cobran compras, apuestas y premios en sats.</li>
            <li>Que necesita tu equipo tecnico para conectar el juego.</li>
          </ul>
        </div>
        <div class="audience-card">
          <strong>Si programas</strong>
          <p>Despues de cada explicacion hay endpoints, tokens y ejemplos minimos para implementar.</p>
          <ul>
            <li>Usa <code>/developers</code> para probar endpoints campo por campo.</li>
            <li>Guarda la API key solo en tu servidor.</li>
            <li>Valida tokens con JWKS o con los endpoints de verify.</li>
          </ul>
        </div>
      </div>

      <div class="content">
        <aside class="toc" aria-label="Indice de secciones">
          <strong>Indice</strong>
          <nav>
            <a href="#conceptos">Conceptos en simple</a>
            <a href="#credenciales">Credenciales</a>
            <a href="#sso">Identidad y SSO</a>
            <a href="#apuestas">Apuestas / escrow</a>
            <a href="#multijugador">Multijugador</a>
            <a href="#leaderboards">Marcadores</a>
            <a href="#webhooks">Webhooks</a>
            <a href="#sdk">SDK TypeScript</a>
            <a href="#skill">Skill para tu IA</a>
            <a href="#endpoints">Endpoints rapidos</a>
          </nav>
        </aside>

        <article class="article">
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

          <section id="skill">
            <h2>9. Skill para tu agente de IA <span class="badge ok">nuevo</span></h2>
            <p class="section-lead">
              Un solo comando instala <strong>todo el conocimiento para integrar tu
              juego con Luna Negra</strong> en tu agente. No tenes que leer esta
              pagina entera: instalas la skill y le pedis a tu IA &ldquo;integra mi
              juego con Luna Negra&rdquo;. Es modular &mdash; podes aplicar solo
              login, o sumar pagos, salas, apuestas o webhooks segun necesites.
            </p>

            <div class="explain-grid">
              <div class="explain">
                <strong>Que hace</strong>
                <span>Le da a tu agente el mapa completo: login SSO, verificar compra, presencia, salas, invitaciones, marcadores, apuestas/escrow, webhooks y el SDK, con los endpoints y las reglas de seguridad.</span>
              </div>
              <div class="explain">
                <strong>Como se instala</strong>
                <span>Con el CLI estandar <code>skills</code>: un comando lee el repo publico y deja el <code>SKILL.md</code> en la carpeta de skills de tu agente. Sirve para Claude Code, Cursor, Codex y demas.</span>
              </div>
            </div>

            <div class="install-hero">
              <span class="step-label">Recomendado &middot; cualquier agente</span>
              <h3>Un comando con el CLI <code>skills</code></h3>
              <div class="cmd">
                <button type="button" class="copy-btn" aria-label="Copiar comando">Copiar</button>
                <pre><code>npx skills add soyezequiel/luna-negra</code></pre>
              </div>
              <p class="hint">
                Funciona desde cualquier carpeta, sin clonar nada. El
                <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noopener">CLI <code>skills</code></a>
                instala la skill en <code>.claude/skills/</code> o
                <code>.agents/skills/</code> segun tu agente. Despues reinicialo y
                pedile: <em>&ldquo;integra mi juego con Luna Negra&rdquo;</em>.
              </p>
              <p class="hint">
                Para saltear la telemetria del CLI:
                <code>DISABLE_TELEMETRY=1 npx skills add soyezequiel/luna-negra</code>.
              </p>
            </div>

            <p class="note">
              <strong>La skill no aplica todo de golpe.</strong> Es un menu: el
              minimo util es el login SSO; presencia, salas, apuestas, marcadores y
              webhooks se suman solo si los pedis. Tu agente te pregunta que queres
              antes de tocar codigo.
            </p>

            <h3>Otras formas de instalarla</h3>
            <p>
              Si no queres usar <code>npx</code>, hay un instalador directo a la
              carpeta de skills de Claude Code y la descarga del archivo. La skill es
              un Markdown autocontenido, asi que tambien sirve como archivo de
              contexto (<code>AGENTS.md</code>) para cualquier agente.
            </p>
            <div class="card-grid">
              <div class="mini-card info">
                <strong>Instalador directo (Claude Code)</strong>
                <div class="cmd" style="margin-top:8px;">
                  <button type="button" class="copy-btn" aria-label="Copiar comando PowerShell">Copiar</button>
                  <pre><code>iwr -useb __LUNA_NEGRA_BASE__/dev/install?ps | iex</code></pre>
                </div>
                <div class="cmd" style="margin-top:8px;">
                  <button type="button" class="copy-btn" aria-label="Copiar comando bash">Copiar</button>
                  <pre><code>curl -fsSL __LUNA_NEGRA_BASE__/dev/install | sh</code></pre>
                </div>
                <span>PowerShell (Windows) o bash (macOS/Linux). Deja el <code>SKILL.md</code> ya configurado con la URL de este deploy.</span>
              </div>
              <div class="mini-card ok">
                <strong>Descargar o pasar por URL</strong>
                <p style="margin:6px 0 0;"><a class="button" href="/dev/skill" download="SKILL.md">Descargar SKILL.md</a></p>
                <div class="cmd" style="margin-top:8px;">
                  <button type="button" class="copy-btn" aria-label="Copiar URL">Copiar</button>
                  <pre><code>__LUNA_NEGRA_BASE__/dev/skill</code></pre>
                </div>
                <span>Guardalo como <code>AGENTS.md</code> en la raiz del repo, o pasale esa URL al agente y pedile que la lea.</span>
              </div>
            </div>
          </section>

          <section id="endpoints">
            <h2>10. Referencia rapida de endpoints</h2>
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
        </article>
      </div>
    </main>

    <footer class="footer shell">
      Esta guia resume el camino recomendado. El contrato completo vive en
      <a href="/developers">/developers</a> y <a href="/openapi.json">/openapi.json</a>.
    </footer>

    <script>
      document.addEventListener("click", function (e) {
        var btn = e.target.closest(".copy-btn");
        if (!btn) return;
        var code = btn.parentElement.querySelector("pre code, code");
        if (!code) return;
        var text = code.textContent.trim();
        var done = function () {
          var prev = btn.textContent;
          btn.textContent = "Copiado";
          btn.classList.add("done");
          setTimeout(function () {
            btn.textContent = prev;
            btn.classList.remove("done");
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (err) {}
          document.body.removeChild(ta);
        }
      });
    </script>
  </body>
</html>`;

export function GET(req: Request) {
  // Las líneas de instalación necesitan la URL real del deploy: la derivamos de
  // las cabeceras y reemplazamos el placeholder antes de servir.
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  const origin = proto + "://" + host;
  const html = HTML.replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
