import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// Tarjeta social de la home: cuando alguien comparte luna.naranja.fit en
// WhatsApp / X / Telegram / Nostr, este es el preview. Se genera con next/og
// (estática, cacheada en build) usando los tokens del rediseño Eclipse para no
// depender de ningún asset de imagen. Reutilizada como og:image y twitter:image.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(1100px 700px at 78% 18%, rgba(157,140,255,0.28), transparent 60%), linear-gradient(135deg, #08070c 0%, #110f18 100%)",
          color: "#e9e6f2",
          fontFamily: "sans-serif",
        }}
      >
        {/* Luna negra: disco oscuro con corona luna (#9d8cff) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "28px",
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              background: "#050409",
              border: "3px solid #9d8cff",
              boxShadow: "0 0 60px 8px rgba(157,140,255,0.55)",
            }}
          />
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div
          style={{
            marginTop: 44,
            fontSize: 46,
            fontWeight: 700,
            lineHeight: 1.18,
            maxWidth: 900,
            color: "#c2b5ff",
          }}
        >
          {SITE_TAGLINE}
        </div>

        <div
          style={{
            marginTop: 36,
            display: "flex",
            gap: 16,
            fontSize: 26,
            color: "#9b95ad",
          }}
        >
          <span>Identidad Nostr</span>
          <span style={{ color: "#4fe6a8" }}>·</span>
          <span>Pagos Lightning</span>
          <span style={{ color: "#ffb648" }}>·</span>
          <span>Zaps a los devs</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
