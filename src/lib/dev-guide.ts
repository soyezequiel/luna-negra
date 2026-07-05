// Estilo y andamiaje compartido por las guías de developers autocontenidas
// (`/dev` = NGP y `/dev/luna` = REST v1). Sirven HTML estático con CSS inline
// para funcionar como documento público aun sin cargar el bundle principal.
//
// El CSS vivía duplicado dentro de `/dev`. Al separar la guía NGP de la vieja
// interfaz REST dependiente de Luna, se movió acá para no mantener dos copias.

export const DEV_GUIDE_STYLE = `
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
        --violet: #a78bfa;
        --violet-hi: #c9b6ff;
        --violet-soft: rgba(167, 139, 250, 0.14);
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
        max-width: 700px;
        color: var(--white);
        font-size: clamp(2.2rem, 5vw, 4.7rem);
        line-height: 1.08;
        letter-spacing: 0;
      }
      .lead {
        max-width: 640px;
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
      .button.violet {
        border-color: transparent;
        background: linear-gradient(95deg, #8b6cf0 0%, #6d4fd0 100%);
        color: #f2ecff;
      }
      .button.violet:hover { color: var(--white); background: linear-gradient(95deg, #9d80ff 0%, #7c5ce6 100%); }
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
      .status.violet {
        border-color: rgba(167, 139, 250, 0.4);
        background: var(--violet-soft);
        color: var(--violet-hi);
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
      .choice-section {
        display: grid;
        grid-template-columns: minmax(220px, 0.52fr) minmax(0, 1.48fr);
        gap: 18px;
        align-items: stretch;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        margin: 0 0 34px;
        padding: 22px 0;
      }
      .choice-head h2 {
        margin: 8px 0 8px;
        color: var(--white);
        font-size: clamp(1.35rem, 3vw, 2rem);
        line-height: 1.18;
      }
      .choice-head p {
        margin: 0;
        color: var(--muted);
        font-size: 0.95rem;
      }
      .choice-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .choice-card {
        display: flex;
        min-height: 178px;
        flex-direction: column;
        gap: 10px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.74);
        padding: 18px;
        text-decoration: none;
      }
      .choice-card:hover {
        border-color: rgba(102, 192, 244, 0.38);
        background: rgba(24, 35, 49, 0.92);
        text-decoration: none;
      }
      .choice-card.recommended {
        border-color: rgba(247, 147, 26, 0.34);
        background: linear-gradient(180deg, rgba(247, 147, 26, 0.1), rgba(18, 26, 36, 0.78));
      }
      .choice-label {
        color: var(--blue-hi);
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
      }
      .choice-card.recommended .choice-label { color: var(--btc-hi); }
      .choice-card strong {
        color: var(--white);
        font-size: 1.12rem;
        line-height: 1.2;
      }
      .choice-card span:not(.choice-label) {
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.42;
      }
      .choice-card em {
        margin-top: auto;
        color: var(--blue-hi);
        font-style: normal;
        font-weight: 800;
      }
      .choice-card.recommended em { color: var(--btc-hi); }
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

      .dep-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
        margin: 0 0 30px;
        border: 1px solid rgba(224, 106, 91, 0.32);
        border-left: 4px solid var(--danger);
        border-radius: 8px;
        background: rgba(224, 106, 91, 0.09);
        padding: 16px 18px;
      }
      .dep-banner .dep-text { flex: 1; min-width: 220px; }
      .dep-banner strong { display: block; color: #ffd9d2; font-size: 1rem; }
      .dep-banner span { display: block; margin-top: 4px; color: #e7b8b1; font-size: 0.9rem; line-height: 1.42; }
      .dep-banner .button { flex: 0 0 auto; margin-left: auto; }
      .dep-banner .button.danger {
        border-color: rgba(224, 106, 91, 0.5);
        background: rgba(224, 106, 91, 0.14);
        color: #ffd9d2;
      }
      .dep-banner .button.danger:hover { background: rgba(224, 106, 91, 0.22); color: var(--white); }

      .switch-card {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
        margin: 0 0 30px;
        border: 1px solid rgba(167, 139, 250, 0.3);
        border-left: 4px solid var(--violet);
        border-radius: 8px;
        background: var(--violet-soft);
        padding: 16px 18px;
      }
      .switch-card .switch-text { flex: 1; min-width: 220px; }
      .switch-card strong { display: block; color: #ede7ff; font-size: 1rem; }
      .switch-card span { display: block; margin-top: 4px; color: #c9bdf0; font-size: 0.9rem; line-height: 1.42; }
      .switch-card .button { flex: 0 0 auto; margin-left: auto; }

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
        line-height: 1.18;
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
      .manual {
        scroll-margin-top: 88px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.5);
      }
      .manual[open] { background: transparent; border-color: transparent; }
      .manual > .manual-summary {
        display: flex;
        align-items: center;
        gap: 14px;
        border-radius: 8px;
        background: rgba(18, 26, 36, 0.74);
        padding: 18px clamp(20px, 4vw, 30px);
        cursor: pointer;
        list-style: none;
        user-select: none;
      }
      .manual > .manual-summary::-webkit-details-marker { display: none; }
      .manual > .manual-summary::after {
        content: "Mostrar";
        flex: 0 0 auto;
        margin-left: auto;
        border: 1px solid var(--line-2);
        border-radius: 4px;
        padding: 7px 12px;
        color: var(--ink);
        font-size: 0.8rem;
        font-weight: 800;
      }
      .manual[open] > .manual-summary::after { content: "Ocultar"; }
      .manual > .manual-summary:hover { background: rgba(24, 35, 49, 0.92); }
      .manual-summary-text { display: grid; gap: 4px; min-width: 0; }
      .manual-summary-main { color: var(--white); font-size: 1.05rem; font-weight: 800; }
      .manual-summary-sub { color: var(--muted); font-size: 0.9rem; line-height: 1.35; }
      .manual[open] { display: grid; gap: 16px; }
      .toc a.toc-sep {
        margin-top: 6px;
        border-top: 1px solid var(--line);
        border-radius: 0;
        padding-top: 12px;
        color: var(--faint);
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
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
      .mini-card.violet { border-color: rgba(167, 139, 250, 0.34); background: var(--violet-soft); }
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
      .badge.warn { background: var(--btc-soft); color: var(--btc-hi); }
      .badge.violet { background: var(--violet-soft); color: var(--violet-hi); }
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
      .note.danger strong { color: #ffd9d2; }
      .note.violet {
        border-color: rgba(167, 139, 250, 0.28);
        border-left-color: var(--violet);
        background: var(--violet-soft);
        color: #d6ccf5;
      }
      .note.violet strong { color: #ede7ff; }
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
      .kind {
        display: inline-flex;
        justify-content: center;
        border-radius: 4px;
        background: var(--violet-soft);
        color: var(--violet-hi);
        padding: 2px 7px;
        font: 800 0.72rem/1.5 ui-monospace, "Cascadia Code", monospace;
      }
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
      .install-hero.violet {
        border-color: rgba(167, 139, 250, 0.42);
        background:
          linear-gradient(180deg, rgba(167, 139, 250, 0.14), transparent 40%),
          rgba(18, 26, 36, 0.9);
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
      .install-hero.violet .step-label { color: var(--violet-hi); }
      .install-hero h3 { margin: 8px 0 4px; color: var(--white); }
      .install-hero .cmd pre { font-size: 0.95rem; }
      .install-hero .hint { margin: 12px 0 0; color: var(--muted); font-size: 0.9rem; }
      .alt-install {
        margin-top: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.14);
      }
      .alt-install > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        color: var(--white);
        cursor: pointer;
        font-weight: 800;
        list-style: none;
      }
      .alt-install > summary::-webkit-details-marker { display: none; }
      .alt-install > summary::after {
        content: "Mostrar";
        flex: 0 0 auto;
        border: 1px solid var(--line-2);
        border-radius: 4px;
        color: var(--muted);
        padding: 5px 9px;
        font-size: 0.74rem;
      }
      .alt-install[open] > summary::after { content: "Ocultar"; }
      .alt-install > p,
      .alt-install > .card-grid {
        margin-left: 16px;
        margin-right: 16px;
      }
      .alt-install > .card-grid { margin-bottom: 16px; }

      @media (max-width: 980px) {
        .hero,
        .content,
        .two-col,
        .choice-section { grid-template-columns: 1fr; }
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
        .flow-panel { display: none; }
        .signal-row,
        .quick-grid,
        .choice-grid,
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
        .dep-banner .button,
        .switch-card .button { margin-left: 0; }
      }
`;

// Script compartido: botón "Copiar" en bloques de código y apertura automática
// del <details> de guía manual cuando se navega a una de sus secciones por ancla.
export const DEV_GUIDE_SCRIPT = `
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

      (function () {
        var manual = document.getElementById("guia-manual");
        if (!manual) return;
        var openFor = function (hash) {
          if (!hash || hash === "#") return;
          var target;
          try { target = document.querySelector(hash); } catch (err) { return; }
          if (target && manual.contains(target)) manual.open = true;
        };
        document.addEventListener("click", function (e) {
          var link = e.target.closest('a[href^="#"]');
          if (!link) return;
          openFor(link.getAttribute("href"));
        });
        window.addEventListener("hashchange", function () { openFor(location.hash); });
        openFor(location.hash);
      })();
`;

/** Ensambla el documento HTML completo con el estilo y el script compartidos. */
export function devGuideDoc(opts: {
  title: string;
  description: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${opts.description}" />
    <title>${opts.title}</title>
    <style>${DEV_GUIDE_STYLE}</style>
  </head>
  <body>
${opts.body}
    <script>${DEV_GUIDE_SCRIPT}</script>
  </body>
</html>`;
}

/** Deriva el origin real del deploy desde las cabeceras de la request. */
export function originFrom(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  return proto + "://" + host;
}
