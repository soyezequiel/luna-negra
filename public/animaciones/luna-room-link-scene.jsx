// Luna Room Link — video explicativo del estándar (63s, 1920×1080)
// Fiel a: docs/luna-room-link.md, room-link-invite.tsx, launch/[slug]/page.tsx,
// tetris/src/main.ts (bootstrapLunaRoomLink / joinLunaRoomLink), enter.ts.
const { Stage, Sprite, useSprite, useTime, Easing, interpolate, clamp } = window;

// ─── Paleta Luna Negra (globals.css) ───
const C = {
  bg: "#08070c", deep: "#050409", panel: "#110f18", card: "#181522", surface: "#221d30",
  text: "#e9e6f2", soft: "#cfc8de", muted: "#9a93ad", faint: "#5f5872",
  luna: "#9d8cff", lunaB: "#c2b5ff", lunaD: "#7d6cf0",
  corona: "#ffb648", coronaB: "#ffcd7a",
  aurora: "#4fe6a8", auroraB: "#84f3c6",
  danger: "#e8907a",
  border: "rgba(255,255,255,0.08)", borderS: "rgba(255,255,255,0.12)",
  onLuna: "#1a1430", onAurora: "#062414", onCorona: "#231304",
};
const F = {
  display: "'Bricolage Grotesque', sans-serif",
  sans: "'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
};

// entrada/salida: 1 mientras t∈[i1,o0], rampas en los bordes
function io(t, i0, i1, o0 = 1e9, o1 = 1e9) {
  const up = clamp((t - i0) / Math.max(i1 - i0, 0.001), 0, 1);
  const dn = 1 - clamp((t - o0) / Math.max(o1 - o0, 0.001), 0, 1);
  return Easing.easeOutCubic(up) * Easing.easeInOutQuad(dn);
}
function rise(t, at, dur = 0.6, dy = 22) {
  const p = Easing.easeOutCubic(clamp((t - at) / dur, 0, 1));
  return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` };
}
function pop(t, at, dur = 0.5) {
  const p = clamp((t - at) / dur, 0, 1);
  const s = 0.86 + 0.14 * Easing.easeOutBack(p);
  return { opacity: Easing.easeOutCubic(p), transform: `scale(${s})` };
}

// ─── piezas compartidas ───
function Abs({ x, y, w, h, style, children }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, ...style }}>
      {children}
    </div>
  );
}

function Chip({ color = C.muted, bg = "rgba(255,255,255,0.04)", border = C.border, dashed, size = 20, style, children }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      fontFamily: F.mono, fontSize: size, fontWeight: 500, color,
      background: bg, border: `1.5px ${dashed ? "dashed" : "solid"} ${border}`,
      borderRadius: 12, padding: "10px 18px", whiteSpace: "nowrap", ...style,
    }}>{children}</div>
  );
}

// URL canónica coloreada por partes
function Url({ domain = "tetra.juego.ar", room = "x7Kp_92q", token = null, size = 24 }) {
  return (
    <span style={{ fontFamily: F.mono, fontSize: size, fontWeight: 500, letterSpacing: "-0.01em" }}>
      <span style={{ color: C.faint }}>https://</span>
      <span style={{ color: C.soft }}>{domain}</span>
      <span style={{ color: C.faint }}>/?</span>
      <span style={{ color: C.luna }}>lnRoom=</span>
      <span style={{ color: C.lunaB, fontWeight: 600 }}>{room}</span>
      {token ? (<>
        <span style={{ color: C.faint }}>&amp;</span>
        <span style={{ color: C.corona }}>lnToken=</span>
        <span style={{ color: C.coronaB }}>{token}</span>
      </>) : null}
    </span>
  );
}

// ventana con barra de navegador
function Browser({ x, y, w, h, url, accent = C.border, style, children }) {
  return (
    <Abs x={x} y={y} w={w} h={h} style={{
      background: C.panel, border: `1.5px solid ${accent}`, borderRadius: 22,
      boxShadow: "0 40px 90px -30px rgba(0,0,0,0.9)", overflow: "hidden", ...style,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 14, height: 58,
        padding: "0 20px", background: C.deep, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", gap: 7 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 99, background: C.surface }}></div>
          ))}
        </div>
        <div style={{
          flex: 1, display: "flex", alignItems: "center", height: 36,
          background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`,
          borderRadius: 99, padding: "0 16px", overflow: "hidden",
        }}>{url}</div>
      </div>
      <div style={{ position: "relative", height: h - 58 }}>{children}</div>
    </Abs>
  );
}

// caption inferior por escena
function Caption({ t, at = 0.5, num, text, out = 1e9 }) {
  const o = io(t, at, at + 0.7, out, out + 0.5);
  return (
    <Abs x={260} y={936} w={1400} style={{ opacity: o, transform: `translateY(${(1 - Math.min(o * 2, 1)) * 16}px)`, textAlign: "center" }}>
      {num ? (
        <div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: "0.24em", color: C.luna, marginBottom: 12 }}>
          {num}
        </div>
      ) : null}
      <div style={{ fontFamily: F.sans, fontSize: 33, lineHeight: 1.4, color: C.soft, fontWeight: 500, textWrap: "balance" }}>
        {text}
      </div>
    </Abs>
  );
}

// cursor con click
function Cursor({ x, y, click = 0, opacity = 1 }) {
  const ripple = click > 0 && click < 1 ? click : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, zIndex: 60, pointerEvents: "none" }}>
      {ripple ? (
        <div style={{
          position: "absolute", left: -6, top: -6, width: 52, height: 52, borderRadius: 99,
          border: `2.5px solid ${C.lunaB}`, opacity: 1 - ripple,
          transform: `scale(${0.3 + ripple * 1.2})`,
        }}></div>
      ) : null}
      <div style={{
        width: 30, height: 34, background: "#fff",
        clipPath: "polygon(0 0, 100% 62%, 55% 68%, 72% 100%, 58% 100%, 44% 72%, 0 88%)",
        filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
      }}></div>
    </div>
  );
}

// avatar de jugador
function Player({ name, hue, badge, badgeColor, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, ...style }}>
      <div style={{ position: "relative" }}>
        <div style={{
          width: 96, height: 96, borderRadius: 99,
          background: `oklch(0.45 0.09 ${hue})`, border: `2px solid ${C.borderS}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: F.display, fontSize: 38, fontWeight: 700, color: C.text,
        }}>{name[0]}</div>
        {badge ? (
          <div style={{
            position: "absolute", left: "50%", top: -18, transform: "translateX(-50%)",
            fontFamily: F.mono, fontSize: 14, fontWeight: 600, letterSpacing: "0.12em",
            color: C.onCorona, background: `linear-gradient(120deg, ${C.coronaB}, ${C.corona})`,
            borderRadius: 99, padding: "4px 12px",
            boxShadow: "0 8px 22px -8px rgba(255,182,72,0.8)",
          }}>{badge}</div>
        ) : null}
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 20, fontWeight: 600, color: C.soft }}>{name}</div>
    </div>
  );
}

// flecha horizontal animada con etiqueta
function Arrow({ x, y, w, t, at, dur = 1.1, reverse, color = C.luna, label }) {
  const p = Easing.easeInOutCubic(clamp((t - at) / dur, 0, 1));
  if (p <= 0) return null;
  const lw = w * p;
  const headX = reverse ? x + w - lw : x + lw;
  return (
    <div style={{ position: "absolute", left: 0, top: 0 }}>
      <div style={{
        position: "absolute", left: reverse ? x + w - lw : x, top: y, width: lw, height: 3,
        background: `linear-gradient(${reverse ? 270 : 90}deg, transparent, ${color})`,
        borderRadius: 2,
      }}></div>
      <div style={{
        position: "absolute", left: headX - 9, top: y - 7.5, width: 18, height: 18,
        background: color, opacity: p,
        clipPath: reverse ? "polygon(100% 0, 0 50%, 100% 100%)" : "polygon(0 0, 100% 50%, 0 100%)",
      }}></div>
      {label ? (
        <div style={{
          position: "absolute", left: x + w / 2, top: y - 34, transform: "translateX(-50%)",
          opacity: clamp(p * 1.6 - 0.3, 0, 1), whiteSpace: "nowrap",
          fontFamily: F.mono, fontSize: 19, color,
          background: C.deep, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 16px",
        }}>{label}</div>
      ) : null}
    </div>
  );
}

// disco lunar (marca)
function Moon({ size = 200, style }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 99, position: "relative", overflow: "hidden",
      background: `radial-gradient(circle at 32% 30%, ${C.lunaB}, ${C.luna} 45%, ${C.lunaD} 78%)`,
      boxShadow: `0 0 ${size * 0.6}px -${size * 0.12}px rgba(157,140,255,0.65)`, ...style,
    }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: 99, background: "#0a0810",
        transform: "translate(28%, -12%) scale(0.94)",
      }}></div>
    </div>
  );
}

function Watermark() {
  return (
    <div style={{
      position: "absolute", left: 56, top: 46, display: "flex", alignItems: "center", gap: 16, opacity: 0.85,
    }}>
      <Moon size={34} />
      <span style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: "0.22em", color: C.faint }}>
        LUNA ROOM LINK
      </span>
    </div>
  );
}

// ══════════════ ESCENA 0 · Título (0–7) ══════════════
function S0() {
  const { localTime: t } = useSprite();
  const zoom = 1 + t * 0.006;
  const moonY = interpolate([0, 7], [40, 0])(t);
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})` }}>
      <div style={{ position: "absolute", left: 860, top: 168 + moonY, ...pop(t, 0.2, 1) }}>
        <Moon size={200} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 430, textAlign: "center", ...rise(t, 0.9) }}>
        <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", color: C.luna, marginBottom: 24 }}>
          LUNA NEGRA · ESTÁNDAR DE INVITACIÓN A SALAS
        </div>
        <div style={{ fontFamily: F.display, fontSize: 118, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: C.text }}>
          Luna Room Link
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", ...rise(t, 2.2) }}>
        <div style={{ fontFamily: F.sans, fontSize: 34, color: C.muted, fontWeight: 500 }}>
          Un solo link. Cualquier canal. La sala se crea cuando alguien llega.
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 760, display: "flex", justifyContent: "center", ...pop(t, 3.6, 0.7) }}>
        <Chip size={26} bg="rgba(157,140,255,0.08)" border="rgba(157,140,255,0.35)" style={{ padding: "16px 30px", borderRadius: 16 }}>
          <Url size={26} domain="<tu-juego>" room="<roomId>" />
        </Chip>
      </div>
      <Caption t={t} at={4.8} text="Así funciona, de la tienda al primer bloque." out={6.3} />
    </div>
  );
}

// ══════════════ ESCENA 1 · La tienda arma el link (7–18) ══════════════
function S1() {
  const { localTime: t } = useSprite();
  // cursor: entra, viaja al botón «Invitar» (centro real ≈ 726,494), click en t=2.6
  const cx = interpolate([0.8, 2.4], [1180, 722], Easing.easeInOutCubic)(t);
  const cy = interpolate([0.8, 2.4], [860, 486], Easing.easeInOutCubic)(t);
  const click = clamp((t - 2.6) / 0.5, 0, 1.001);
  const phase = t < 2.7 ? "idle" : t < 4.2 ? "loading" : "ready";
  const zoom = 1 + Math.min(t, 10) * 0.007;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "44% 46%" }}>
      <div style={{ ...pop(t, 0.1, 0.7), position: "absolute", inset: 0 }}>
        <Browser x={330} y={130} w={800} h={640}
          url={<span style={{ fontFamily: F.mono, fontSize: 17, color: C.muted }}>lunanegra.app<span style={{ color: C.faint }}>/game/tetra</span></span>}>
          {/* ficha del juego */}
          <div style={{ padding: "30px 36px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{
                width: 72, height: 72, borderRadius: 18, background: C.surface,
                border: `1px solid ${C.borderS}`, display: "grid",
                gridTemplateColumns: "repeat(2, 22px)", gridTemplateRows: "repeat(2, 22px)",
                gap: 5, placeContent: "center",
              }}>
                <div style={{ background: C.luna, borderRadius: 4 }}></div>
                <div style={{ background: C.aurora, borderRadius: 4 }}></div>
                <div style={{ background: C.corona, borderRadius: 4 }}></div>
                <div style={{ background: C.lunaD, borderRadius: 4 }}></div>
              </div>
              <div>
                <div style={{ fontFamily: F.display, fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: C.text }}>TETRA</div>
                <div style={{ fontFamily: F.mono, fontSize: 15, color: C.faint, marginTop: 2 }}>tetra.juego.ar · multijugador</div>
              </div>
            </div>

            {/* panel "Jugá con amigos" — réplica de room-link-invite.tsx */}
            <div style={{
              marginTop: 34, borderRadius: 18, padding: "26px 28px",
              border: "1.5px solid rgba(157,140,255,0.3)", background: "rgba(157,140,255,0.06)",
            }}>
              <div style={{ fontFamily: F.sans, fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 6 }}>Jugá con amigos</div>
              <div style={{ fontFamily: F.sans, fontSize: 19, color: C.muted, marginBottom: 22, lineHeight: 1.45 }}>
                Creá un enlace de sala para TETRA y compartilo. Quien lo abra entra directo, sin instalar nada.
              </div>
              {phase !== "ready" ? (
                <div style={{
                  height: 62, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: F.sans, fontSize: 22, fontWeight: 700,
                  background: `linear-gradient(120deg, ${C.lunaB}, ${C.luna})`, color: C.onLuna,
                  boxShadow: click > 0 ? "0 14px 36px -12px rgba(157,140,255,0.7)" : "none",
                  transform: click > 0 && click < 0.4 ? "scale(0.97)" : "scale(1)",
                  opacity: phase === "loading" ? 0.75 : 1,
                }}>{phase === "loading" ? "Creando enlace…" : "🎮 Invitar a jugar"}</div>
              ) : (
                <div style={{ display: "flex", gap: 12, ...pop(t, 4.2, 0.5) }}>
                  <div style={{
                    flex: 1, height: 58, borderRadius: 14, display: "flex", alignItems: "center",
                    padding: "0 18px", background: C.bg, border: `1px solid ${C.borderS}`, overflow: "hidden",
                  }}><Url size={19} /></div>
                  <div style={{
                    height: 58, borderRadius: 99, padding: "0 26px", display: "flex", alignItems: "center",
                    fontFamily: F.sans, fontSize: 20, fontWeight: 700,
                    background: `linear-gradient(120deg, ${C.auroraB}, ${C.aurora})`, color: C.onAurora,
                  }}>Copiar</div>
                </div>
              )}
            </div>
          </div>
        </Browser>
        {phase === "loading" ? (
          <div style={{ position: "absolute", left: 470, top: 800, ...pop(t, 2.9, 0.4) }}>
            <Chip color={C.lunaB} bg="rgba(157,140,255,0.08)" border="rgba(157,140,255,0.3)" size={19}>
              POST /api/v1/rooms/invite <span style={{ color: C.faint }}>· sesión, no API key</span>
            </Chip>
          </div>
        ) : null}
        <Cursor x={cx} y={cy} click={click} opacity={io(t, 0.8, 1.1, 4.6, 5.2)} />

        {/* anotaciones: lo que NO pasó */}
        <div style={{ position: "absolute", left: 1220, top: 300, ...rise(t, 5.6) }}>
          <Chip dashed size={22} color={C.muted} style={{ padding: "16px 24px" }}>
            ✕&nbsp; el juego <span style={{ color: C.soft }}>nunca se abrió</span>
          </Chip>
        </div>
        <div style={{ position: "absolute", left: 1220, top: 396, ...rise(t, 6.6) }}>
          <Chip dashed size={22} color={C.muted} style={{ padding: "16px 24px" }}>
            ✕&nbsp; la sala <span style={{ color: C.soft }}>todavía no existe</span>
          </Chip>
        </div>
        <div style={{ position: "absolute", left: 1220, top: 500, ...rise(t, 7.6) }}>
          <Chip size={19} color={C.faint}>
            Luna ya conoce <span style={{ color: C.lunaB }}>Game.gameUrl</span> — con eso alcanza
          </Chip>
        </div>
      </div>
      <Caption t={t} at={8.2} num="PASO 1 · MINTEAR" out={10.2}
        text="Luna arma el link sola, desde la ficha. El link lleva el dominio del juego — no el de Luna." />
    </div>
  );
}

// ══════════════ ESCENA 2 · El link viaja (18–27) ══════════════
function S2() {
  const { localTime: t } = useSprite();
  const channels = [
    { name: "WhatsApp", at: 1.2, x: 210, y: 190 },
    { name: "Discord", at: 2.4, x: 690, y: 300 },
    { name: "Chat de Luna", at: 3.6, x: 1170, y: 190 },
  ];
  const zoom = 1 + t * 0.006;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 42%" }}>
      {channels.map((ch) => (
        <Abs key={ch.name} x={ch.x} y={ch.y} w={540} style={{
          ...pop(t, ch.at, 0.6),
          background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: 22,
          boxShadow: "0 34px 80px -30px rgba(0,0,0,0.85)", padding: 26,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: C.aurora }}></div>
            <span style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase" }}>{ch.name}</span>
          </div>
          <div style={{
            ...pop(t, ch.at + 0.5, 0.5),
            background: C.card, border: `1px solid ${C.borderS}`, borderRadius: "18px 18px 18px 6px",
            padding: "16px 20px", display: "inline-block", maxWidth: "100%",
          }}>
            <div style={{ fontFamily: F.sans, fontSize: 19, color: C.soft, marginBottom: 8 }}>dale, entrá acá 👇</div>
            <div style={{ textDecoration: "underline", textDecorationColor: "rgba(157,140,255,0.5)", textUnderlineOffset: 5 }}>
              <Url size={17} />
            </div>
          </div>
        </Abs>
      ))}
      <div style={{ position: "absolute", left: 0, right: 0, top: 660, display: "flex", justifyContent: "center", ...rise(t, 5) }}>
        <Chip size={21} color={C.muted} style={{ padding: "14px 26px" }}>
          sin app de Luna, sin token en el link — <span style={{ color: C.soft }}>una URL y ya</span>
        </Chip>
      </div>
      <Caption t={t} at={5.8} num="PASO 2 · COMPARTIR" out={8.2}
        text="Es una URL normal. Viaja por el canal que sea — el estándar no depende del transporte." />
    </div>
  );
}

// ══════════════ ESCENA 3 · Cold open (27–41) ══════════════
function S3() {
  const { localTime: t } = useSprite();
  const zoom = 1 + Math.min(t, 12) * 0.005;
  const gameAccent = t > 11.2 ? "rgba(79,230,168,0.45)" : t > 2 ? "rgba(232,144,122,0.4)" : C.border;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 40%" }}>
      {/* juego */}
      <div style={{ ...pop(t, 0.2, 0.7), position: "absolute", inset: 0 }}>
        <Browser x={80} y={150} w={660} h={560} accent={gameAccent}
          url={<span style={{ fontFamily: F.mono, fontSize: 16 }}>
            <span style={{ color: C.soft }}>tetra.juego.ar</span>
            <span style={{ color: C.luna }}>/?lnRoom=</span><span style={{ color: C.lunaB }}>x7Kp_92q</span>
            {t > 11.2 ? <span style={{ color: C.corona }}>&amp;lnToken=eyJ…</span> : null}
          </span>}>
          <div style={{ padding: "34px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontFamily: F.display, fontSize: 30, fontWeight: 700, color: C.text }}>TETRA</div>
            <div style={{ ...rise(t, 1.2) }}>
              <Chip size={19} color={C.lunaB} bg="rgba(157,140,255,0.08)" border="rgba(157,140,255,0.3)">
                ✓ leí <span style={{ color: C.luna }}>lnRoom</span> = x7Kp_92q
              </Chip>
            </div>
            <div style={{ ...rise(t, 2.2) }}>
              <Chip size={19} color={C.danger} bg="rgba(232,144,122,0.07)" border="rgba(232,144,122,0.35)">
                ✕ no hay <span style={{ color: C.corona }}>lnToken</span> — no sé quién sos
              </Chip>
            </div>
            {t > 11.2 ? (
              <div style={{ ...rise(t, 11.4) }}>
                <Chip size={19} color={C.auroraB} bg="rgba(79,230,168,0.07)" border="rgba(79,230,168,0.35)">
                  ✓ identidad verificada offline (JWKS) → a la sala
                </Chip>
              </div>
            ) : (
              <div style={{ ...rise(t, 3.2), fontFamily: F.sans, fontSize: 18, color: C.faint }}>
                → rebotar a Luna preservando la sala
              </div>
            )}
          </div>
        </Browser>
      </div>

      {/* Luna */}
      <div style={{ ...pop(t, 0.4, 0.7), position: "absolute", inset: 0 }}>
        <Browser x={1180} y={150} w={660} h={560}
          accent={t > 6 && t < 11.5 ? "rgba(157,140,255,0.5)" : C.border}
          url={<span style={{ fontFamily: F.mono, fontSize: 16 }}>
            <span style={{ color: C.soft }}>lunanegra.app</span>
            <span style={{ color: t > 4 ? C.lunaB : C.faint }}>{t > 4 ? "/launch/tetra?returnTo=…" : ""}</span>
          </span>}>
          <div style={{ padding: "34px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Moon size={38} />
              <span style={{ fontFamily: F.display, fontSize: 26, fontWeight: 700, color: C.text }}>Luna Negra</span>
            </div>
            <div style={{ ...rise(t, 6.2) }}>
              <Chip size={19} color={C.auroraB} bg="rgba(79,230,168,0.07)" border="rgba(79,230,168,0.35)">
                ✓ sesión encontrada (o login)
              </Chip>
            </div>
            <div style={{ ...rise(t, 7.2) }}>
              <Chip size={19} color={C.coronaB} bg="rgba(255,182,72,0.07)" border="rgba(255,182,72,0.35)">
                ✓ minteo un <span style={{ color: C.corona }}>lnToken</span> fresco (ES256)
              </Chip>
            </div>
            <div style={{ ...rise(t, 8.2) }}>
              <Chip size={16} color={C.faint}>
                🛡 returnTo validado contra Game.gameUrl
              </Chip>
            </div>
          </div>
        </Browser>
      </div>

      <Arrow t={t} at={4} x={780} y={330} w={360} color={C.luna}
        label={<span>GET /launch/tetra<span style={{ color: C.faint }}>?returnTo=…</span></span>} />
      <Arrow t={t} at={9.6} x={780} y={520} w={360} reverse color={C.corona}
        label={<span>302 · lnRoom + <span style={{ color: C.coronaB }}>lnToken</span></span>} />

      <Caption t={t} at={0.6} num="PASO 3 · COLD OPEN" out={5.4}
        text="Alguien abre el link crudo: cae en el dominio del juego sin identidad." />
      <Caption t={t} at={5.9} num="PASO 3 · COLD OPEN" out={10.8}
        text="El juego rebota a Luna con returnTo. Luna autentica y firma un lnToken de vuelta." />
      <Caption t={t} at={11.3} num="PASO 3 · COLD OPEN"
        text="De vuelta en el juego, con el lnRoom intacto: identidad resuelta, sin backend compartido." />
    </div>
  );
}

// ══════════════ ESCENA 4 · Creación lazy (41–51) ══════════════
function S4() {
  const { localTime: t } = useSprite();
  const solid = clamp((t - 2.6) / 0.8, 0, 1); // la sala se materializa
  const zoom = 1 + t * 0.006;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 42%" }}>
      {/* backend del juego pregunta */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 130, display: "flex", justifyContent: "center", gap: 16, ...rise(t, 0.3) }}>
        <Chip size={21} color={C.soft}>
          ¿existe la sala <span style={{ color: C.lunaB }}>x7Kp_92q</span> en mi backend?
        </Chip>
        <div style={{ ...pop(t, 1.6, 0.4) }}>
          <Chip size={21} color={C.coronaB} bg="rgba(255,182,72,0.07)" border="rgba(255,182,72,0.35)">
            no → <b>crearla</b>
          </Chip>
        </div>
      </div>

      {/* la sala */}
      <Abs x={560} y={250} w={800} h={430} style={{
        ...pop(t, 0.8, 0.7),
        borderRadius: 26,
        border: solid >= 1 ? "2px solid rgba(157,140,255,0.5)" : "2px dashed rgba(255,255,255,0.16)",
        background: `rgba(24,21,34,${0.25 + solid * 0.75})`,
        boxShadow: solid > 0.5 ? "0 30px 80px -30px rgba(157,140,255,0.45)" : "none",
      }}>
        <div style={{
          position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)",
          fontFamily: F.mono, fontSize: 18, letterSpacing: "0.1em",
          color: solid > 0.5 ? C.lunaB : C.faint,
          background: C.bg, padding: "4px 18px", borderRadius: 99,
          border: `1px solid ${solid > 0.5 ? "rgba(157,140,255,0.4)" : C.border}`,
        }}>sala x7Kp_92q{solid < 1 ? " · (no existe)" : ""}</div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 110, height: "100%" }}>
          <div style={{ ...pop(t, 3.2, 0.7) }}>
            <Player name="Vale" hue={300} badge="HOST" />
          </div>
          <div style={{ ...pop(t, 5.6, 0.7) }}>
            <Player name="Tomi" hue={160} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, textAlign: "center", ...rise(t, 6.4) }}>
          <span style={{ fontFamily: F.sans, fontSize: 19, color: C.muted }}>
            <span style={{ color: C.coronaB }}>el primero que entra crea la sala y es el host</span> · los demás se unen
          </span>
        </div>
      </Abs>

      <div style={{ position: "absolute", left: 0, right: 0, top: 730, display: "flex", justifyContent: "center", ...rise(t, 7.2) }}>
        <Chip size={18} color={C.faint}>
          history.replaceState() → los tokens no quedan en la URL ni en el historial
        </Chip>
      </div>

      <Caption t={t} at={7.9} num="PASO 4 · SALA LAZY"
        text="La sala nunca pre-existió. Nadie la reservó: el link la describe, el primer jugador la crea." />
    </div>
  );
}

// ══════════════ ESCENA 5 · El contrato + cierre (51–63) ══════════════
function S5() {
  const { localTime: t } = useSprite();
  const steps = [
    ["1", <span>leer <b style={{ color: C.lunaB }}>lnRoom</b> de la URL</span>],
    ["2", <span>sin <b style={{ color: C.coronaB }}>lnToken</b> → rebotar a /launch/&lt;slug&gt;</span>],
    ["3", <span>verificar identidad offline vía <b style={{ color: C.soft }}>JWKS</b></span>],
    ["4", <span>sala inexistente → <b style={{ color: C.coronaB }}>crearla</b> (host = primero)</span>],
    ["5", <span>limpiar los params de la URL</span>],
  ];
  const toggleOn = t > 4.6;
  const outAt = 8.6; // el diagrama sale, queda el cierre
  const boardO = io(t, 0, 0.6, outAt, outAt + 0.7);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", inset: 0, opacity: boardO }}>
        {/* contrato */}
        <Abs x={180} y={150} w={760} style={{
          ...pop(t, 0.2, 0.6),
          background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: 24, padding: "34px 38px",
        }}>
          <div style={{ fontFamily: F.mono, fontSize: 16, letterSpacing: "0.22em", color: C.luna, marginBottom: 8 }}>EL CONTRATO DEL JUEGO</div>
          <div style={{ fontFamily: F.display, fontSize: 34, fontWeight: 700, color: C.text, marginBottom: 26 }}>Cinco pasos, ninguno de Luna</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {steps.map(([n, node], i) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 18, ...rise(t, 0.9 + i * 0.55, 0.5, 14) }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: F.mono, fontSize: 19, fontWeight: 600, color: C.lunaB,
                  background: "rgba(157,140,255,0.1)", border: "1px solid rgba(157,140,255,0.3)",
                }}>{n}</div>
                <div style={{ fontFamily: F.sans, fontSize: 23, color: C.soft }}>{node}</div>
              </div>
            ))}
          </div>
        </Abs>

        {/* recompensa: capability → botón */}
        <Abs x={1030} y={200} w={720} style={{ ...pop(t, 3.8, 0.6) }}>
          <div style={{
            background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: 24, padding: "30px 34px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <span style={{ fontFamily: F.mono, fontSize: 19, color: C.soft }}>capability: <b style={{ color: C.lunaB }}>roomLink</b></span>
              <div style={{
                width: 74, height: 40, borderRadius: 99, position: "relative",
                background: toggleOn ? `linear-gradient(120deg, ${C.lunaB}, ${C.luna})` : C.surface,
                border: `1px solid ${C.borderS}`,
              }}>
                <div style={{
                  position: "absolute", top: 4, left: toggleOn ? 38 : 4, width: 30, height: 30,
                  borderRadius: 99, background: toggleOn ? C.onLuna : C.faint,
                }}></div>
              </div>
            </div>
            <div style={{
              borderRadius: 18, padding: "22px 24px",
              border: "1.5px solid rgba(157,140,255,0.3)", background: "rgba(157,140,255,0.06)",
              opacity: toggleOn ? 1 : 0.25, transform: toggleOn ? "scale(1)" : "scale(0.985)",
            }}>
              <div style={{ fontFamily: F.sans, fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 14 }}>Jugá con amigos</div>
              <div style={{
                height: 54, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: F.sans, fontSize: 20, fontWeight: 700,
                background: `linear-gradient(120deg, ${C.lunaB}, ${C.luna})`, color: C.onLuna,
                boxShadow: toggleOn ? "0 14px 36px -12px rgba(157,140,255,0.7)" : "none",
              }}>🎮 Invitar a jugar</div>
            </div>
            <div style={{ marginTop: 18, ...rise(t, 5.4) }}>
              <span style={{ fontFamily: F.sans, fontSize: 19, color: C.muted }}>
                El botón aparece en la ficha de <b style={{ color: C.soft }}>cualquier</b> juego que declare la capability.
              </span>
            </div>
          </div>
        </Abs>

        <Caption t={t} at={6} num="POR ESO ES UN ESTÁNDAR" out={outAt}
          text="Implementá el contrato y tu juego gana «Invitar a jugar» en Luna Negra. Sin código a medida." />
      </div>

      {/* cierre */}
      <div style={{ position: "absolute", inset: 0, opacity: io(t, outAt + 0.4, outAt + 1.1) }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 330, display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
          <Moon size={120} />
          <div style={{ fontFamily: F.display, fontSize: 72, fontWeight: 800, letterSpacing: "-0.03em", color: C.text }}>Luna Room Link</div>
          <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted }}>
            docs/<span style={{ color: C.lunaB }}>luna-room-link.md</span> · implementación de referencia: TETRA
          </div>
        </div>
      </div>
    </div>
  );
}

// etiqueta de timestamp para comentarios
function ScreenLabel() {
  const t = useTime();
  React.useEffect(() => {
    const el = document.querySelector("[data-video-root]");
    if (el) el.setAttribute("data-screen-label", `t=${Math.floor(t)}s`);
  }, [Math.floor(t)]);
  return null;
}

function LunaRoomLinkVideo({ loop = false }) {
  return (
    <div data-video-root style={{ width: "100%", height: "100%" }}>
      <Stage width={1920} height={1080} duration={63} background={C.bg} loop={loop}>
        {/* fondo con brillo lunar sutil */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(1200px 700px at 50% -10%, rgba(157,140,255,0.09), transparent 65%), radial-gradient(900px 600px at 85% 110%, rgba(125,108,240,0.06), transparent 60%)`,
        }}></div>
        <ScreenLabel />
        <Sprite start={7} end={63}><Watermark /></Sprite>
        <Sprite start={0} end={7.4}><S0 /></Sprite>
        <Sprite start={7} end={18.4}><S1 /></Sprite>
        <Sprite start={18} end={27.4}><S2 /></Sprite>
        <Sprite start={27} end={41.4}><S3 /></Sprite>
        <Sprite start={41} end={51.4}><S4 /></Sprite>
        <Sprite start={51} end={63}><S5 /></Sprite>
      </Stage>
    </div>
  );
}

window.LunaRoomLinkVideo = LunaRoomLinkVideo;
