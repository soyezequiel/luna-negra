// Guía del desarrollador — Nostr Games Protocol (NGP).
//
// Documento público autocontenido (HTML + CSS + JS inline, sin bundle). El
// jugador firma eventos Nostr; los relays los guardan; cualquier cliente los
// lee. La vieja interfaz REST v1 (dependiente de Luna Negra) sigue en /dev/luna.
//
// Diseño "Eclipse": fondo negro, marca Luna (violeta) / Corona (dorado) /
// Aurora (verde), tipografías Bricolage Grotesque + Geist. El hero trae un
// diagrama animado del flujo NGP y un selector de niveles de adopción (N0–N3)
// que resalta las partes del diagrama; la guía manual es un acordeón.

import { originFrom } from "@/lib/dev-guide";

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
  .wrap { max-width: 1120px; margin: 0 auto; padding: 32px 24px 96px; position: relative; }

  /* header */
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 52px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
  .brand-mark { width: 34px; height: 34px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #221d30 0%, #0a0810 70%); box-shadow: 0 0 0 1px rgba(157,140,255,0.35), 0 0 22px -4px rgba(255,182,72,0.55); position: relative; }
  .brand-mark::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; background: radial-gradient(circle at 50% 50%, transparent 54%, rgba(255,182,72,0.4) 58%, transparent 70%); }
  .brand-name { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; color: #e9e6f2; }
  .brand-sub { font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #5f5872; margin-top: 3px; }
  .top-links { display: flex; gap: 22px; font-size: 13.5px; color: #9a93ad; flex-wrap: wrap; }
  .top-links a { text-decoration: none; }
  .top-links a:hover { color: #e9e6f2; }
  .status { display: flex; align-items: center; gap: 8px; font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #ffb648; border: 1px solid rgba(255,182,72,0.35); background: rgba(255,182,72,0.08); padding: 6px 12px; border-radius: 999px; }
  .status .dot { width: 6px; height: 6px; border-radius: 50%; background: #ffb648; box-shadow: 0 0 8px #ffb648; }

  /* hero */
  .hero { max-width: 760px; margin-bottom: 40px; }
  .eyebrow { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #9d8cff; margin-bottom: 18px; }
  h1 { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: clamp(38px, 6vw, 66px); line-height: 0.98; letter-spacing: -0.03em; margin: 0 0 22px; }
  h1 .accent { color: #9d8cff; }
  .lead { font-size: 18px; line-height: 1.6; color: #cfc8de; margin: 0 0 26px; max-width: 620px; text-wrap: pretty; }
  .lead strong { color: #e9e6f2; font-weight: 600; }
  .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 12px 22px; border-radius: 999px; font-weight: 600; font-size: 15px; }
  .btn.primary { background: linear-gradient(120deg, #c2b5ff, #9d8cff); color: #1a1430; font-weight: 700; box-shadow: 0 14px 36px -12px rgba(157,140,255,0.7); }
  .btn.ghost { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #e9e6f2; }

  /* card */
  .card { background: rgba(24,21,34,0.6); border: 1px solid rgba(255,255,255,0.07); border-radius: 22px; padding: 26px; margin-bottom: 22px; box-shadow: 0 30px 80px -40px rgba(0,0,0,0.9); }
  .card-label { font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #5f5872; margin-bottom: 12px; }

  /* level selector */
  .levels { display: flex; gap: 10px; margin-bottom: 26px; flex-wrap: wrap; }
  .lvl { position: relative; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left; cursor: pointer; padding: 13px 16px; border-radius: 14px; min-width: 132px; flex: 1 1 132px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); font-family: inherit; transition: all .25s ease; }
  .lvl .lvl-id { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: #9a93ad; }
  .lvl .lvl-name { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: -0.01em; color: #e9e6f2; }
  .lvl[data-active="1"] { background: var(--lvl-tint); border-color: var(--lvl-hex); box-shadow: 0 10px 26px -14px var(--lvl-glow); }

  /* diagram */
  .diagram { position: relative; padding: 14px 6px 8px; }
  .track { position: absolute; left: 8%; right: 8%; top: 92px; height: 0; z-index: 4; pointer-events: none; }
  .pill { position: absolute; top: 50%; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-family: 'Geist Mono', monospace; font-size: 11px; font-weight: 600; white-space: nowrap; color: #08070c; }
  .pill.p1 { animation: ngp-flow 3.6s cubic-bezier(0.6,0,0.4,1) infinite; }
  .pill.p2 { animation: ngp-flow 3.6s cubic-bezier(0.6,0,0.4,1) infinite; animation-delay: 1.8s; }
  .grid { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 4px; min-height: 184px; }
  .node { transition: opacity .45s ease, filter .45s ease; }
  .node[data-on="0"] { opacity: 0.3; filter: grayscale(0.4); }
  .nbox { position: relative; border-radius: 18px; padding: 18px 16px; text-align: center; transition: box-shadow .4s ease, border-color .4s ease; border: 1px solid rgba(255,255,255,0.09); }
  .nbox.jugador { background: linear-gradient(160deg, rgba(157,140,255,0.10), rgba(24,21,34,0.4)); }
  .nbox.relays { background: rgba(24,21,34,0.55); border-color: rgba(255,255,255,0.08); padding: 16px 14px; }
  .nbox.clientes { background: linear-gradient(160deg, rgba(79,230,168,0.09), rgba(24,21,34,0.4)); border-color: rgba(255,255,255,0.08); padding: 16px 14px; }
  .node[data-on="1"] .nbox.glow-luna { border-color: #9d8cff; box-shadow: 0 0 0 1px #9d8cff, 0 18px 44px -16px rgba(157,140,255,0.6); }
  .node[data-on="1"] .nbox.glow-aurora { border-color: #4fe6a8; box-shadow: 0 0 0 1px #4fe6a8, 0 18px 44px -16px rgba(79,230,168,0.6); }
  .sign { width: 46px; height: 46px; margin: 0 auto 12px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #221d30, #0a0810); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 1px rgba(157,140,255,0.4); animation: ngp-pulse 2.6s ease-out infinite; font-size: 20px; }
  .ntitle { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
  .nsub { font-size: 12.5px; color: #9a93ad; margin-top: 4px; line-height: 1.4; }
  .ntag { display: inline-flex; margin-top: 12px; font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.08em; color: #c2b5ff; background: rgba(157,140,255,0.12); border: 1px solid rgba(157,140,255,0.3); padding: 4px 9px; border-radius: 999px; }
  .conn { min-width: 40px; height: 2px; border-radius: 2px; }
  .conn.c1 { background: linear-gradient(90deg, rgba(157,140,255,0.5), rgba(157,140,255,0.15)); }
  .conn.c2 { background: linear-gradient(90deg, rgba(79,230,168,0.15), rgba(79,230,168,0.5)); }
  .relaylist { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
  .relaydot { display: flex; align-items: center; gap: 8px; justify-content: center; font-family: 'Geist Mono', monospace; font-size: 11px; color: #9a93ad; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 6px 8px; border-radius: 8px; animation: ngp-relay 2.4s ease-in-out infinite; }
  .relaydot .g { width: 6px; height: 6px; border-radius: 50%; background: #4fe6a8; box-shadow: 0 0 7px #4fe6a8; }
  .clist { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
  .cli { font-family: 'Geist Mono', monospace; font-size: 11px; color: #9a93ad; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 6px 8px; border-radius: 8px; }
  .cli.hi { font-family: 'Geist', sans-serif; font-size: 12.5px; font-weight: 600; color: #e9e6f2; background: rgba(157,140,255,0.12); border: 1px solid rgba(157,140,255,0.28); padding: 7px 8px; }
  .anchor { display: flex; justify-content: center; margin-top: 20px; }
  .anchor-chip { display: inline-flex; align-items: center; gap: 9px; font-family: 'Geist Mono', monospace; font-size: 11px; color: #9a93ad; background: rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.14); padding: 7px 14px; border-radius: 999px; animation: ngp-float 4s ease-in-out infinite; }
  .anchor-chip .u { color: #5f5872; letter-spacing: 0.1em; text-transform: uppercase; font-size: 9.5px; }
  .anchor-chip .coord { color: #c2b5ff; }

  /* detail */
  .detail { display: grid; grid-template-columns: 1fr 1.15fr; gap: 22px; margin-bottom: 46px; }
  .detail-panel { display: none; }
  .detail-panel[data-active="1"] { display: contents; }
  .dbox { background: rgba(24,21,34,0.6); border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; padding: 26px; }
  .dhead { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .dbadge { font-family: 'Geist Mono', monospace; font-weight: 600; font-size: 13px; padding: 5px 11px; border-radius: 8px; }
  .dbadge.luna { background: rgba(157,140,255,0.14); color: #c2b5ff; border: 1px solid #9d8cff; }
  .dbadge.aurora { background: rgba(79,230,168,0.14); color: #84f3c6; border: 1px solid #4fe6a8; }
  .dbadge.corona { background: rgba(255,182,72,0.14); color: #ffcd7a; border: 1px solid #ffb648; }
  .dtitle { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 26px; letter-spacing: -0.02em; }
  .dnip { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5f5872; margin-bottom: 18px; }
  .ddesc { font-size: 15px; line-height: 1.68; color: #cfc8de; margin: 0 0 18px; text-wrap: pretty; }
  .dtip { display: flex; align-items: flex-start; gap: 10px; padding: 13px 15px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); font-size: 13.5px; line-height: 1.55; color: #9a93ad; }
  .dcode { display: flex; flex-direction: column; gap: 14px; }

  /* code term */
  .term { background: #050409; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; overflow: hidden; }
  .term.aurora { border-color: rgba(79,230,168,0.2); }
  .term-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .term-title { font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9a93ad; }
  .term-title.aurora { color: #84f3c6; display: flex; align-items: center; gap: 8px; }
  .term-title.aurora .g { width: 6px; height: 6px; border-radius: 50%; background: #4fe6a8; box-shadow: 0 0 7px #4fe6a8; }
  .copy { cursor: pointer; font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9a93ad; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 7px; }
  .copy:hover { color: #e9e6f2; }
  .copy.violet { color: #c2b5ff; background: rgba(157,140,255,0.12); border-color: rgba(157,140,255,0.3); }
  .copy.done { color: #84f3c6; border-color: rgba(79,230,168,0.5); background: rgba(79,230,168,0.12); }
  pre { margin: 0; padding: 18px; overflow-x: auto; font-family: 'Geist Mono', monospace; font-size: 12.5px; line-height: 1.65; color: #cfc8de; }
  pre.sm { font-size: 12px; padding: 16px; }
  pre code { display: block; white-space: pre; }

  /* skill */
  .section { margin-bottom: 46px; }
  .section-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 30px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .section-sub { font-size: 15px; color: #9a93ad; margin: 0 0 22px; max-width: 720px; line-height: 1.6; }
  .badge-rec { font-family: 'Geist Mono', monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #84f3c6; background: rgba(79,230,168,0.14); border: 1px solid rgba(79,230,168,0.3); padding: 5px 10px; border-radius: 8px; }
  .skill-hero { background: linear-gradient(150deg, rgba(157,140,255,0.12), rgba(24,21,34,0.5)); border: 1px solid rgba(157,140,255,0.28); border-radius: 20px; padding: 26px; }
  .skill-hero .label { font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #c2b5ff; margin-bottom: 8px; }
  .skill-hero h3 { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 20px; letter-spacing: -0.01em; margin: 0 0 16px; }
  .cmd { background: #050409; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; margin-bottom: 10px; }
  .cmd-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .cmd-head span { font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9a93ad; }
  .cmd pre { padding: 14px 16px; }
  .skill-note { font-size: 13.5px; line-height: 1.55; color: #9a93ad; margin: 16px 0 0; }
  .skill-note code, .inline-code { font-family: 'Geist Mono', monospace; color: #c2b5ff; background: #050409; border: 1px solid rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 6px; }
  .honesty { display: flex; gap: 12px; margin-top: 16px; padding: 15px 18px; border-radius: 14px; background: rgba(255,182,72,0.07); border: 1px solid rgba(255,182,72,0.2); }
  .honesty p { font-size: 13.5px; line-height: 1.6; color: #cfc8de; margin: 0; }
  .honesty strong { color: #ffcd7a; font-weight: 600; }
  .honesty a { color: #ffcd7a; text-decoration: underline; text-underline-offset: 2px; }

  /* accordion */
  .acc { display: flex; flex-direction: column; gap: 10px; }
  .item { border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; background: rgba(24,21,34,0.5); overflow: hidden; }
  .item > summary { cursor: pointer; display: flex; align-items: center; gap: 14px; padding: 16px 20px; list-style: none; }
  .item > summary::-webkit-details-marker { display: none; }
  .item > summary:hover { background: rgba(255,255,255,0.02); }
  .item[open] > summary { border-bottom: 1px solid rgba(255,255,255,0.06); }
  .item-num { font-family: 'Geist Mono', monospace; font-size: 12px; color: #5f5872; flex-shrink: 0; }
  .item-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .item-titlerow { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .item-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.01em; color: #e9e6f2; }
  .item-sub { font-size: 13px; color: #9a93ad; }
  .chev { margin-left: auto; flex-shrink: 0; color: #9a93ad; transition: transform .25s ease; font-size: 16px; }
  .item[open] .chev { transform: rotate(180deg); }
  .item-body { padding: 18px 20px 22px; }
  .item-body p { font-size: 14.5px; line-height: 1.6; color: #9a93ad; margin: 0 0 14px; }
  .tag { font-family: 'Geist Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px; }
  .tag.aurora { color: #84f3c6; background: rgba(79,230,168,0.14); border: 1px solid rgba(79,230,168,0.3); }
  .tag.luna { color: #c2b5ff; background: rgba(157,140,255,0.14); border: 1px solid rgba(157,140,255,0.3); }
  .tag.corona { color: #ffcd7a; background: rgba(255,182,72,0.14); border: 1px solid rgba(255,182,72,0.3); }
  .kbadge { font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 600; color: #c2b5ff; background: rgba(157,140,255,0.14); border: 1px solid rgba(157,140,255,0.3); padding: 2px 7px; border-radius: 6px; }
  .warn { display: flex; gap: 12px; margin-top: 12px; padding: 13px 16px; border-radius: 0 12px 12px 0; background: rgba(232,144,122,0.07); border-left: 3px solid #e8907a; }
  .warn p { font-size: 13px; line-height: 1.55; color: #cfc8de; margin: 0; }
  .warn strong { color: #f0b3a3; font-weight: 600; }
  .hint { display: flex; gap: 12px; margin-top: 12px; padding: 13px 16px; border-radius: 0 12px 12px 0; background: rgba(157,140,255,0.06); border-left: 3px solid #9d8cff; }
  .hint p { font-size: 13px; line-height: 1.55; color: #cfc8de; margin: 0; }
  .hint strong { color: #c2b5ff; font-weight: 600; }
  .item-body code { font-family: 'Geist Mono', monospace; color: #c2b5ff; }
  .cards2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
  .mini { padding: 14px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }
  .mini.violet { background: rgba(157,140,255,0.06); border-color: rgba(157,140,255,0.22); }
  .mini strong { display: block; font-size: 13.5px; color: #e9e6f2; margin-bottom: 5px; }
  .mini span { font-size: 13px; line-height: 1.5; color: #9a93ad; }
  .steps3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .step { padding: 15px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }
  .step .n { font-family: 'Geist Mono', monospace; font-size: 20px; font-weight: 600; color: #c2b5ff; }
  .step strong { display: block; font-size: 14px; color: #e9e6f2; margin: 4px 0; }
  .step span { font-size: 12.5px; line-height: 1.5; color: #9a93ad; }
  .rows { display: flex; flex-direction: column; gap: 10px; }
  .row2 { display: grid; grid-template-columns: 200px 1fr; gap: 16px; padding: 14px 18px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }
  .row2 strong { font-size: 14px; color: #ffcd7a; }
  .row2 span { font-size: 13px; line-height: 1.5; color: #9a93ad; }

  /* kinds table */
  .ktable { border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; }
  .krow { display: flex; align-items: center; gap: 14px; padding: 13px 18px; }
  .krow:nth-child(even) { background: rgba(255,255,255,0.015); }
  .krow + .krow { border-top: 1px solid rgba(255,255,255,0.05); }
  .kkind { font-family: 'Geist Mono', monospace; font-size: 13px; font-weight: 600; color: #c2b5ff; min-width: 70px; }
  .kwhat { flex: 1; font-size: 14px; color: #cfc8de; }
  .kstate { font-family: 'Geist Mono', monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; padding: 4px 9px; border-radius: 6px; color: #9a93ad; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
  .kstate.aurora { color: #84f3c6; background: rgba(79,230,168,0.14); border-color: rgba(79,230,168,0.3); }
  .kstate.corona { color: #ffcd7a; background: rgba(255,182,72,0.14); border-color: rgba(255,182,72,0.3); }

  /* checklist */
  .checklist { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .check { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; background: rgba(24,21,34,0.5); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; }
  .check .cb { flex-shrink: 0; min-width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; padding: 0 6px; font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 600; margin-top: 1px; }
  .cb.luna { background: rgba(157,140,255,0.14); color: #c2b5ff; }
  .cb.aurora { background: rgba(79,230,168,0.14); color: #84f3c6; }
  .cb.corona { background: rgba(255,182,72,0.14); color: #ffcd7a; }
  .check span.t { font-size: 14px; line-height: 1.5; color: #cfc8de; }

  footer.foot { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 22px; display: flex; gap: 12px; align-items: flex-start; }
  footer.foot p { font-size: 12.5px; line-height: 1.6; color: #5f5872; margin: 0; max-width: 760px; }
  footer.foot a { color: #9a93ad; text-decoration: underline; text-underline-offset: 2px; }
  footer.foot code { font-family: 'Geist Mono', monospace; color: #9a93ad; }

  @keyframes ngp-flow {
    0%   { left: 1%;  opacity: 0; transform: translateY(-50%) scale(0.7); }
    9%   { opacity: 1; transform: translateY(-50%) scale(1); }
    91%  { opacity: 1; transform: translateY(-50%) scale(1); }
    100% { left: 99%; opacity: 0; transform: translateY(-50%) scale(0.7); }
  }
  @keyframes ngp-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(157,140,255,0.55); } 60% { box-shadow: 0 0 0 14px rgba(157,140,255,0); } }
  @keyframes ngp-relay { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes ngp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @media (prefers-reduced-motion: reduce) { .pill, .sign, .relaydot, .anchor-chip { animation: none !important; } }

  @media (max-width: 860px) {
    .detail { grid-template-columns: 1fr; }
    .detail-panel[data-active="1"] { display: block; }
    .detail-panel[data-active="1"] .dbox { margin-bottom: 14px; }
  }
  @media (max-width: 680px) {
    .grid { grid-template-columns: 1fr; gap: 10px; }
    .conn { display: none; }
    .track { display: none; }
    .row2 { grid-template-columns: 1fr; gap: 4px; }
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
      <a href="#skill">Skill IA</a>
      <a href="#niveles">Niveles</a>
      <a href="#guia">Guía manual</a>
      <a href="#kinds">Kinds</a>
      <a href="/dev/animaciones">Animaciones</a>
      <a href="/dev/luna">Versión REST 1.0</a>
    </nav>
    <div class="status"><span class="dot"></span>Corre en producción · Tetris</div>
  </header>

  <section class="hero" id="inicio">
    <div class="eyebrow">Nostr Games Protocol · NGP</div>
    <h1>Tu juego habla Nostr.<br><span class="accent">Nadie en el medio.</span></h1>
    <p class="lead">El jugador <strong>firma</strong> el evento con su propia llave. Los <strong>relays</strong> lo guardan. Y <strong>cualquier cliente Nostr</strong> lo lee — sin API central, sin cuentas propias. Sigue funcionando aunque Luna Negra desaparezca.</p>
    <div class="hero-actions">
      <a class="btn primary" href="#skill">Instalar skill NGP</a>
      <a class="btn ghost" href="#guia">Ver la guía manual</a>
    </div>
  </section>

  <section class="card" id="niveles">
    <div class="card-label">Niveles de adopción · elegí uno</div>
    <div class="levels" id="levels">
      <button class="lvl" data-level="N0"><span class="lvl-id">N0</span><span class="lvl-name">Identidad</span></button>
      <button class="lvl" data-level="N1"><span class="lvl-id">N1</span><span class="lvl-name">Marcador</span></button>
      <button class="lvl" data-level="N2"><span class="lvl-id">N2</span><span class="lvl-name">Social</span></button>
      <button class="lvl" data-level="N3"><span class="lvl-id">N3</span><span class="lvl-name">Económico</span></button>
    </div>

    <div class="diagram">
      <div class="track">
        <span class="pill p1" id="pill1">pubkey</span>
        <span class="pill p2" id="pill2">pubkey</span>
      </div>
      <div class="grid">
        <div class="node" data-node="jugador" data-on="1">
          <div class="nbox jugador glow-luna">
            <div class="sign">🔑</div>
            <div class="ntitle">Jugador</div>
            <div class="nsub">firma con su propia llave</div>
            <div class="ntag">NIP-07 / NIP-46</div>
          </div>
        </div>
        <div class="conn c1"></div>
        <div class="node" data-node="relays" data-on="0">
          <div class="nbox relays glow-luna">
            <div class="ntitle">Relays Nostr</div>
            <div class="relaylist">
              <div class="relaydot"><span class="g"></span>relay.damus.io</div>
              <div class="relaydot" style="animation-delay:.8s"><span class="g"></span>nos.lol</div>
              <div class="relaydot" style="animation-delay:1.6s"><span class="g"></span>relay.primal.net</div>
            </div>
          </div>
        </div>
        <div class="conn c2"></div>
        <div class="node" data-node="clientes" data-on="0">
          <div class="nbox clientes glow-aurora">
            <div class="ntitle">Cualquier cliente</div>
            <div class="nsub" style="margin-bottom:0">lee los mismos eventos</div>
            <div class="clist">
              <div class="cli hi">Luna Negra</div>
              <div class="cli">Otros clientes Nostr</div>
              <div class="cli">Tu propio front</div>
            </div>
          </div>
        </div>
      </div>
      <div class="anchor">
        <div class="anchor-chip"><span class="u">Todo ancla en</span><span class="coord">30023:&lt;dev&gt;:&lt;slug&gt;</span><span class="u" style="text-transform:none;letter-spacing:0;font-size:11px;color:#5f5872">— la coordenada del juego</span></div>
      </div>
    </div>
  </section>

  <section class="detail" id="detail"></section>

  <section class="section" id="skill">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
      <h2 class="section-title" style="margin:0">Integrá con una skill de IA</h2>
      <span class="badge-rec">Recomendado</span>
    </div>
    <p class="section-sub">Instalá el contexto de NGP una vez y pedile a tu agente que conecte solo lo que necesitás: login Nostr, marcador firmado, presencia, retos 1v1, reseñas, zaps o apuestas v2.</p>

    <div class="skill-hero">
      <div class="label">Recomendado · cualquier agente</div>
      <h3>Instalá la skill NGP desde este deploy</h3>
      <div class="cmd">
        <div class="cmd-head"><span>PowerShell</span><button class="copy violet">Copiar</button></div>
        <pre><code>iwr -useb "__LUNA_NEGRA_BASE__/dev/install?version=ngp&amp;ps" | iex</code></pre>
      </div>
      <div class="cmd">
        <div class="cmd-head"><span>bash</span><button class="copy violet">Copiar</button></div>
        <pre><code>curl -fsSL "__LUNA_NEGRA_BASE__/dev/install?version=ngp" | sh</code></pre>
      </div>
      <p class="skill-note">Deja el <code>SKILL.md</code> de <code>integrar-ngp-v2</code> en la carpeta de skills de tu agente, con la URL de este deploy ya configurada. Reinicialo y pedí: <em style="color:#cfc8de;font-style:normal">"integrá mi juego con NGP"</em>.</p>
    </div>

    <div class="honesty">
      <span style="font-size:17px;line-height:1.3">⚡</span>
      <p><strong>NGP es experimental, pero ya corre en producción en Tetris.</strong> Identidad, marcador, presencia, retos, reseñas, zaps y apuestas v2 están probados ahí. Escrow REST, webhooks y compra de pago siguen en la <a href="/dev/luna">versión REST 1.0</a>.</p>
    </div>
  </section>

  <section class="section" id="guia">
    <h2 class="section-title">Guía manual de eventos NGP</h2>
    <p class="section-sub" style="margin-bottom:20px">Abrí solo la sección que necesites. Cada una es un evento Nostr, en orden. Todo probado en Tetris.</p>
    <div class="acc" id="acc">

      <details class="item" id="relays">
        <summary>
          <span class="item-num">00</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Relays probados</span><span class="tag aurora">Tetris</span></span>
            <span class="item-sub">Cuáles usar para leer, escribir y DMs — y a cuál nunca publicar.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <div class="term"><div class="term-head"><span class="term-title">relays.ts</span><button class="copy">Copiar</button></div><pre class="sm"><code>// Lectura de perfiles / contactos / presencia
const PROFILE_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol", "wss://relay.primal.net"];

// DMs / retos NIP-17 (escritura + lectura)
const DM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social"];

// Publicar metadata firmada (presencia 30315, marcador 31337)
const PUBLIC_WRITE_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];</code></pre></div>
          <div class="warn"><span style="font-size:15px">⚠️</span><p><strong>No publiques a <code>relay.nostr.band</code>:</strong> es un indexador de solo lectura que rechaza escrituras. Va en <code>PROFILE_RELAYS</code> (igual reindexa), pero no en los sets de escritura.</p></div>
        </div>
      </details>

      <details class="item" id="identidad">
        <summary>
          <span class="item-num">01</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Identidad Nostr</span></span>
            <span class="item-sub">Login con el signer; la pubkey es el playerId estable.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>El jugador entra con un signer Nostr. El juego nunca crea cuentas: usa la <code>pubkey</code> como player id estable.</p>
          <div class="term"><div class="term-head"><span class="term-title">identity.ts</span><button class="copy">Copiar</button></div><pre class="sm"><code>async function getNostrIdentity() {
  if (!window.nostr) throw new Error("No hay signer NIP-07");
  const pubkey = await window.nostr.getPublicKey();
  return { pubkey };   // usalo como playerId estable
}</code></pre></div>
          <div class="hint"><span style="font-size:15px">💡</span><p><strong>Esperá la inyección:</strong> algunas extensiones agregan <code>window.nostr</code> después de cargar. Sondeá hasta ~3 s. Con NIP-46, no firmes en cada heartbeat: cada firma puede disparar un prompt.</p></div>
        </div>
      </details>

      <details class="item" id="coordenada">
        <summary>
          <span class="item-num">02</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">La "dirección" del juego</span><span class="tag luna">gameCoord</span></span>
            <span class="item-sub">La etiqueta única a la que se ancla cada evento del juego.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>Pensala como la dirección postal del juego: una etiqueta única que no cambia y no depende de Luna Negra. Cada puntaje, presencia o reseña la lleva. Técnicamente es una coordenada NIP-23.</p>
          <div class="term"><div class="term-head"><span class="term-title">coordenada</span><button class="copy">Copiar</button></div><pre><code>30023:&lt;pubkey-de-la-tienda&gt;:&lt;slug&gt;

// Leer la coordenada real desde relays:
{ kinds: [30023], "#d": ["&lt;slug&gt;"] }</code></pre></div>
          <div class="cards2">
            <div class="mini"><strong>Es el <code>a</code>-tag de todo</strong><span>Scores, presencia y actividad se anclan acá. Existe mientras exista el <code>kind:30023</code> del juego en algún relay.</span></div>
            <div class="mini violet"><strong>No la inventes</strong><span>Obtenela de <code>GET /api/v1/session</code> o del <code>kind:30023</code> real. El slug no siempre coincide con el nombre visible.</span></div>
          </div>
        </div>
      </details>

      <details class="item" id="marcador">
        <summary>
          <span class="item-num">03</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Marcador</span><span class="kbadge">kind:31337</span><span class="tag aurora">Implementado</span></span>
            <span class="item-sub">El jugador firma su puntaje; cualquiera lee el ranking.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>El jugador firma su mejor puntaje y lo publica a relays. Luna Negra lo proyecta al mismo ranking que el camino REST, pero cualquier cliente Nostr también lo lee. Es lo único que esta spec define nuevo.</p>
          <div class="term"><div class="term-head"><span class="term-title">publishScore.ts</span><button class="copy">Copiar</button></div><pre class="sm"><code>import { SimplePool } from "nostr-tools";
const board = "clasico";

const evt = await window.nostr.signEvent({
  kind: 31337,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", gameCoord],                 // GAME — ancla
    ["d", gameCoord + ":" + board],   // un registro por jugador y tabla
    ["board", board],
    ["score", String(puntaje)],       // entero no negativo, como string
    ["client", "tu-juego"],
  ],
  content: "",
});
await Promise.any(new SimplePool().publish(PUBLIC_WRITE_RELAYS, evt));

// Leer el ranking sin Luna Negra:
{ kinds: [31337], "#a": [gameCoord], "#board": [board] }</code></pre></div>
          <div class="warn"><span style="font-size:15px">⚠️</span><p><strong>Anti-trampa:</strong> el puntaje lo firma el cliente y es falsificable. Sirve para rankings sociales, no para repartir dinero. Para stakes existe el tier verificado <code>kind:31338</code> (oráculo, diseño). Nombres de <code>board</code> deben coincidir con los del camino REST.</p></div>
        </div>
      </details>

      <details class="item" id="presencia">
        <summary>
          <span class="item-num">04</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Presencia "jugando X" — NIP-38</span></span>
            <span class="item-sub">El jugador publica "jugando X" con un TTL corto.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>El propio jugador firma su estado. No hace falta game server: Luna Negra y cualquier cliente derivan "Jugando &lt;juego&gt;" de este evento.</p>
          <div class="term"><div class="term-head"><span class="term-title">kind:30315</span><button class="copy">Copiar</button></div><pre><code>{
  "kind": 30315,
  "tags": [
    ["d", "general"],
    ["a", "30023:&lt;tienda&gt;:&lt;slug&gt;"],
    ["expiration", "&lt;unix + 60-240s&gt;"]
  ],
  "content": "Jugando Pac-Toshi"
}</code></pre></div>
          <div class="hint"><span style="font-size:15px">💡</span><p>Re-firmá solo si cambió el estado o pasaron ~2 min; el <code>expiration</code> debe superar tu heartbeat. El <code>content</code> va <strong>sin emoji</strong> (Luna Negra antepone 🎮). En logout, firmá con <code>content:""</code> y expiration inmediato para que desaparezca.</p></div>
        </div>
      </details>

      <details class="item" id="retos">
        <summary>
          <span class="item-num">05</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Retos e invitaciones — NIP-17</span><span class="tag aurora">Reto 1v1 OK</span></span>
            <span class="item-sub">Invitación 1v1 cifrada de punta a punta.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>La invitación es un reto cifrado E2E. El server no puede leerlo. El rumor interno es <code>kind:14</code> y viaja como gift-wrap <code>kind:1059</code>.</p>
          <div class="term"><div class="term-head"><span class="term-title">rumor kind:14</span><button class="copy">Copiar</button></div><pre><code>{
  "kind": 14,
  "pubkey": "&lt;retador&gt;",
  "tags": [
    ["p", "&lt;invitado&gt;"],
    ["game", "30023:&lt;tienda&gt;:&lt;slug&gt;"],
    ["url", "https://tu-juego.com/?room=..."],
    ["expiration", "&lt;unix&gt;"]
  ],
  "content": "Te reto a una partida"
}</code></pre></div>
          <div class="warn"><span style="font-size:15px">⚠️</span><p><strong>La causa #1 de "reto no llega"</strong> es publicar en un set de relays y escuchar en otro. Usá la misma <code>resolveDmRelays(pubkey)</code> en envío y recepción, e incluí los <code>kind:10050</code> del destinatario. Al recibir: desenvolver 1059 → seal 13 → rumor 14, y verificar <code>rumor.pubkey === seal.pubkey</code>. Escuchá con lookback de ~3 días (NIP-59 aleatoriza timestamps).</p></div>
        </div>
      </details>

      <details class="item" id="social">
        <summary>
          <span class="item-num">06</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Reseñas, logros y zaps</span></span>
            <span class="item-sub">Comentarios, logros y propinas colgados del juego.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>Reseñas y logros cuelgan de la coordenada (<code>kind:1</code> con tag <code>a</code>=GAME). Los zaps NIP-57 sirven para propinas y premios sin escrow; los recibos <code>kind:9735</code> verificados alimentan el "top de zappers".</p>
          <div class="term"><div class="term-head"><span class="term-title">reseña kind:1</span><button class="copy">Copiar</button></div><pre><code>{
  "kind": 1,
  "tags": [["a", "30023:&lt;tienda&gt;:&lt;slug&gt;"]],
  "content": "Gran juego, nuevo logro desbloqueado"
}</code></pre></div>
          <div class="hint"><span style="font-size:15px">💡</span><p><strong>No mezcles</strong> zaps libres con apuestas custodiadas. Si hay depósito, pozo y payout, usá el flujo de apuestas v2 por zaps (abajo).</p></div>
        </div>
      </details>

      <details class="item" id="apuestas">
        <summary>
          <span class="item-num">07</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Apuestas v2 por zaps</span><span class="tag aurora">Tetris</span><span class="tag corona">Gated</span></span>
            <span class="item-sub">Escrow custodial con depósitos por zap.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>Probado en producción, gated por deploy (<code>BETS_V2_ENABLED</code>). Aunque use zaps NIP-57 públicos, sigue siendo escrow custodial server-to-server: lo que cambia frente a la apuesta REST v1 es el riel — depósitos, premio y cortes quedan auditables como zaps en relays.</p>
          <div class="steps3">
            <div class="step"><span class="n">01</span><strong>Crear pozo</strong><span><code>POST /api/v2/bets</code> desde tu game server con API key.</span></div>
            <div class="step"><span class="n">02</span><strong>Depósito por zap</strong><span>El jugador firma un <code>kind:9734</code>; el server lo reenvía al callback y obtiene el invoice.</span></div>
            <div class="step"><span class="n">03</span><strong>Resolver</strong><span><code>POST /api/v2/bets/{id}/result</code> desde el game server.</span></div>
          </div>
          <div class="term"><div class="term-head"><span class="term-title">endpoints v2</span><button class="copy">Copiar</button></div><pre class="sm"><code>POST /api/v2/bets             { gameId, participants, stakeSats, victoryCondition, roomId }
GET  /api/v2/bets/{id}        // estado + por participante: depositZapRequest + depositCallback
POST /api/v2/bets/{id}/result { "winners": ["npub1..."] }   // vacío = empate/anulación (refund)
POST /api/v2/bets/{id}/cancel</code></pre></div>
          <div class="warn"><span style="font-size:15px">⚠️</span><p><strong>El resultado viene del game server</strong>, no del marcador cliente. Por defecto con API key: Luna firma el resultado con el oráculo gestionado y el juego no toca Nostr. Modo keyless opcional: declarás tu clave de oráculo una vez y firmás vos el <code>kind:1341</code> (la firma es la auth, sin API key) — detalle en la skill. <code>winners</code> vacío = empate/anulación → reembolso. Para no construir UI, mandá al jugador a <code>/apuestas/{betId}</code>.</p></div>
        </div>
      </details>

      <details class="item" id="que-no">
        <summary>
          <span class="item-num">08</span>
          <span class="item-txt">
            <span class="item-titlerow"><span class="item-title">Lo que NO se hace solo con eventos</span></span>
            <span class="item-sub">Dinero, compra de pago y webhooks: eso queda en la 1.0.</span>
          </span>
          <span class="chev">▾</span>
        </summary>
        <div class="item-body">
          <p>Nostr es mensajería firmada, no liquidación de dinero. Estas piezas se quedan en la interfaz REST 1.0 — es lo único que las cubre hoy.</p>
          <div class="rows">
            <div class="row2"><strong>Escrow / apuestas</strong><span>Retener stake y pagar al ganador exige un custodio. El escrow v1 vive en 1.0; apuestas v2 por zaps siguen siendo custodiales.</span></div>
            <div class="row2"><strong>Compra de juego de pago</strong><span>Alguien tiene que validar el pago Lightning antes de dar acceso.</span></div>
            <div class="row2"><strong>Webhooks firmados</strong><span>Avisos server-to-server con HMAC — no hay evento Nostr equivalente.</span></div>
          </div>
        </div>
      </details>

    </div>
  </section>

  <section class="section" id="kinds">
    <h2 class="section-title">Resumen de kinds</h2>
    <p class="section-sub">La spec completa vive en <code class="inline-code">docs/nostr-games-protocol.md</code>. Los propuestos pueden cambiar.</p>
    <div class="ktable">
      <div class="krow"><span class="kkind">0</span><span class="kwhat">Perfil del jugador (NIP-01)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">1</span><span class="kwhat">Reseñas / comentarios / logros (tag a=GAME)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">30023</span><span class="kwhat">Artículo del juego (define la coordenada)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">30315</span><span class="kwhat">Presencia "jugando X" (NIP-38)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">1059</span><span class="kwhat">Reto / invitación gift-wrap (NIP-17)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">9735</span><span class="kwhat">Recibo de zap (NIP-57)</span><span class="kstate">estándar</span></div>
      <div class="krow"><span class="kkind">31337</span><span class="kwhat">Mejor puntaje del jugador</span><span class="kstate aurora">implementado</span></div>
      <div class="krow"><span class="kkind">31338</span><span class="kwhat">Atestación de puntaje (oráculo)</span><span class="kstate corona">diseño</span></div>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">Checklist para el dev</h2>
    <p class="section-sub">Implementá hasta donde te sirva. Los niveles se apilan.</p>
    <div class="checklist">
      <div class="check"><span class="cb luna">N0</span><span class="t">Login NIP-07/46 → obtengo la pubkey del jugador.</span></div>
      <div class="check"><span class="cb luna">N0</span><span class="t">Tengo la coordenada GAME (30023:dev:slug) del juego.</span></div>
      <div class="check"><span class="cb luna">N1</span><span class="t">Publico el score (kind 31337) firmado por el jugador, con tags a y board.</span></div>
      <div class="check"><span class="cb luna">N1</span><span class="t">Leo el ranking con el filtro { kinds:[31337], "#a":[GAME] }.</span></div>
      <div class="check"><span class="cb aurora">N2</span><span class="t">Presencia NIP-38 (kind 30315) con expiration. Opcional.</span></div>
      <div class="check"><span class="cb aurora">N2</span><span class="t">Reseñas y logros: kind 1 con tag a = GAME. Opcional.</span></div>
      <div class="check"><span class="cb corona">N3</span><span class="t">Zaps NIP-57 para propinas y premios. Opcional.</span></div>
      <div class="check"><span class="cb corona">1.0</span><span class="t">Apuestas y compra de pago → API REST 1.0, no NGP puro.</span></div>
    </div>
  </section>

  <footer class="foot">
    <span style="font-size:15px">⚠️</span>
    <p>NGP es una capa experimental sobre eventos Nostr, ya en producción en Tetris. La interfaz REST 1.0 dependiente de Luna Negra vive en <a href="/dev/luna">/dev/luna</a> y se está dejando de usar. Los <code>kind</code> marcados como <em style="font-style:normal;color:#9a93ad">propuesto</em> (31337, 31338) pueden cambiar hasta congelar la v1 de la spec.</p>
  </footer>

</div>
`;

const SCRIPT = `
  (function () {
    var COLORS = {
      luna:   { hex: "#9d8cff", tint: "rgba(157,140,255,0.14)", glow: "rgba(157,140,255,0.6)" },
      aurora: { hex: "#4fe6a8", tint: "rgba(79,230,168,0.14)",  glow: "rgba(79,230,168,0.6)" },
      corona: { hex: "#ffb648", tint: "rgba(255,182,72,0.14)",  glow: "rgba(255,182,72,0.6)" }
    };
    var LEVELS = {
      N0: {
        color: "luna", active: ["jugador"], packet: "pubkey",
        name: "Identidad", nip: "NIP-07 / NIP-46 · estándar",
        desc: "El mínimo absoluto, y lo que todos los juegos necesitan. El jugador entra firmando un desafío con su extensión de navegador (NIP-07) o con el celular vía QR (NIP-46). Su pubkey Nostr es un playerId estable — tu juego nunca crea cuentas propias ni guarda contraseñas.",
        tip: "La pubkey es la identidad. No hay servidor de cuentas: si el jugador tiene su llave, ya puede jugar.",
        codeTitle: "obtener la identidad",
        code: "// N0 — identidad del jugador\\nconst pubkey = await window.nostr.getPublicKey();\\n\\n// pubkey  =>  playerId estable (npub / hex)\\n// NIP-46 (celular): mismo window.nostr,\\n// firmado por un signer remoto vía QR."
      },
      N1: {
        color: "luna", active: ["jugador","relays","clientes"], packet: "kind 31337 · score",
        name: "Marcador", nip: "kind 31337 · esta spec (implementado)",
        desc: "La única pieza nueva que define NGP; todo lo demás reusa NIPs que ya existen. Un puntaje es un evento addressable firmado POR EL JUGADOR (no por Luna Negra) que tagea la coordenada del juego (a) y una tabla (board). El relay guarda un único registro por jugador y tabla: se queda el mejor, igual que hoy.",
        tip: "El score lo firma el jugador: sirve para rankings sociales, es falsificable. Para premios con dinero, sumá una atestación de oráculo (kind 31338).",
        codeTitle: "evento de puntaje",
        code: "{\\n  \\"kind\\": 31337,\\n  \\"pubkey\\": \\"<pubkey del jugador>\\",   // firma el JUGADOR\\n  \\"created_at\\": 1719360000,\\n  \\"tags\\": [\\n    [\\"a\\", \\"30023:npub1dev…:pacman-pwa\\"],       // GAME — ancla\\n    [\\"d\\", \\"30023:npub1dev…:pacman-pwa:clasico\\"],\\n    [\\"board\\", \\"clasico\\"],\\n    [\\"score\\", \\"128400\\"],\\n    [\\"unit\\", \\"points\\"]\\n  ],\\n  \\"content\\": \\"{\\\\\\"level\\\\\\":7}\\"\\n}",
        filter: "{\\n  \\"kinds\\": [31337],\\n  \\"#a\\": [\\"30023:npub1dev…:pacman-pwa\\"],\\n  \\"#board\\": [\\"clasico\\"]\\n}\\n\\n// agrupá por pubkey, ordená por score.\\n// No hace falta Luna Negra."
      },
      N2: {
        color: "aurora", active: ["jugador","relays","clientes"], packet: "kind 30315 · presencia",
        name: "Social", nip: "NIP-38 · kind 30315 · estándar",
        desc: "El firmador del jugador publica su estado \\"Jugando X\\" (kind 30315) con un expiration corto de ~30-240s. Luna Negra y cualquier cliente derivan la presencia de ese evento. Reseñas, comentarios y logros son kind 1 tageando la coordenada del juego. No hay nada nuevo que implementar del lado del juego.",
        tip: "En la 1.0 el game server reporta presencia por REST y Luna Negra firma. En NGP firma el propio jugador — no depende de nadie.",
        codeTitle: "presencia \\"jugando X\\"",
        code: "{\\n  \\"kind\\": 30315,                    // NIP-38 user status\\n  \\"pubkey\\": \\"<pubkey del jugador>\\",\\n  \\"tags\\": [\\n    [\\"d\\", \\"general\\"],\\n    [\\"a\\", \\"30023:npub1dev…:pacman-pwa\\"],  // a qué juego\\n    [\\"expiration\\", \\"1719360300\\"]          // TTL ~30-240s\\n  ],\\n  \\"content\\": \\"Jugando Pac-Toshi\\"\\n}"
      },
      N3: {
        color: "corona", active: ["jugador","relays","clientes"], packet: "zap · NIP-57",
        name: "Económico", nip: "NIP-57 · kind 9735 · estándar",
        desc: "Para juegos gratis o para premiar al ganador: un zap (NIP-57) firmado por el usuario al dev o al ganador. El recibo (kind 9735) es verificable → podés armar un \\"top de zappers\\" por juego. Es NIP-57 estándar, no requiere nada propio de Luna Negra. Pero escrow, apuestas y compra de pago exigen un custodio: eso se queda en la API REST 1.0.",
        tip: "Regla de oro: el dinero y la custodia se quedan en la 1.0. NGP publica la prueba de lo que pasó, no mueve los fondos.",
        codeTitle: "propina / premio (zap)",
        code: "// NIP-57 estándar — el usuario zapea\\n// al dev o al ganador.\\n{\\n  \\"kind\\": 9735,                 // recibo de zap\\n  \\"tags\\": [\\n    [\\"a\\", \\"30023:npub1dev…:pacman-pwa\\"],\\n    [\\"p\\", \\"<pubkey del dev / ganador>\\"]\\n  ]\\n}\\n\\n// escrow / compra de pago → API REST 1.0\\n// (no NGP puro)"
      }
    };

    var esc = function (s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    var detailEl = document.getElementById("detail");
    var pill1 = document.getElementById("pill1");
    var pill2 = document.getElementById("pill2");
    var nodes = {};
    document.querySelectorAll("[data-node]").forEach(function (n) { nodes[n.getAttribute("data-node")] = n; });
    var buttons = document.querySelectorAll(".lvl");

    function renderDetail(id) {
      var L = LEVELS[id];
      var filterBlock = L.filter
        ? '<div class="term aurora"><div class="term-head"><span class="term-title aurora"><span class="g"></span>Leer el ranking — cualquier cliente</span><button class="copy">Copiar</button></div><pre><code>' + esc(L.filter) + '</code></pre></div>'
        : "";
      detailEl.innerHTML =
        '<div class="detail-panel" data-active="1">' +
          '<div class="dbox">' +
            '<div class="dhead"><span class="dbadge ' + L.color + '">' + id + '</span><span class="dtitle">' + L.name + '</span></div>' +
            '<div class="dnip">' + L.nip + '</div>' +
            '<p class="ddesc">' + L.desc + '</p>' +
            '<div class="dtip"><span style="font-size:15px;line-height:1.3">💡</span><span>' + L.tip + '</span></div>' +
          '</div>' +
          '<div class="dcode">' +
            '<div class="term"><div class="term-head"><span class="term-title">' + L.codeTitle + '</span><button class="copy">Copiar</button></div><pre><code>' + esc(L.code) + '</code></pre></div>' +
            filterBlock +
          '</div>' +
        '</div>';
    }

    function select(id) {
      var L = LEVELS[id];
      var c = COLORS[L.color];
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-level") === id;
        b.setAttribute("data-active", on ? "1" : "0");
        if (on) {
          b.style.setProperty("--lvl-tint", c.tint);
          b.style.setProperty("--lvl-hex", c.hex);
          b.style.setProperty("--lvl-glow", c.glow);
        }
      });
      [pill1, pill2].forEach(function (p) {
        p.textContent = L.packet;
        p.style.background = c.hex;
        p.style.boxShadow = "0 8px 22px -6px " + c.glow;
      });
      Object.keys(nodes).forEach(function (k) {
        nodes[k].setAttribute("data-on", L.active.indexOf(k) >= 0 ? "1" : "0");
      });
      renderDetail(id);
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () { select(b.getAttribute("data-level")); });
    });
    select("N1");

    // copy buttons (delegated)
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy");
      if (!btn) return;
      var container = btn.closest(".term, .cmd");
      var code = container && container.querySelector("pre code");
      if (!code) return;
      var text = code.textContent;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = "Copiado ✓";
        btn.classList.add("done");
        setTimeout(function () { btn.textContent = prev; btn.classList.remove("done"); }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (err) {}
        document.body.removeChild(ta);
      }
    });

    // open accordion item when navigating to its anchor
    function openHash(hash) {
      if (!hash || hash === "#") return;
      var t;
      try { t = document.querySelector(hash); } catch (err) { return; }
      if (t && t.classList && t.classList.contains("item")) t.open = true;
    }
    document.addEventListener("click", function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (link) openHash(link.getAttribute("href"));
    });
    window.addEventListener("hashchange", function () { openHash(location.hash); });
    openHash(location.hash);
  })();
`;

function doc(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Integra tu juego con Luna Negra usando eventos Nostr (NGP): login NIP-07/46, marcador kind:31337, presencia NIP-38, retos NIP-17, reseñas, zaps y apuestas v2." />
<title>Luna Negra · Nostr Games Protocol (NGP) para developers</title>
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

export function GET(req: Request) {
  // Las líneas de instalación necesitan la URL real del deploy.
  const origin = originFrom(req);
  const html = doc().replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
