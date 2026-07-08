import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  IntegrationMatrix,
  type IntegrationView,
} from "@/components/provider/integration-matrix";

// Smoke test de render (SSR) de la matriz de verificación NGP + NGE: ejercita
// los estados NGE (sin credencial / esperando señal / detectado) y las señales
// NGP nuevas (login inferido, presence del probador) sin navegador.

const ping = (iso: string) => ({ count: 3, firstSeenAt: iso, lastSeenAt: iso });
const recent = () => new Date().toISOString();
const old = () => new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

const baseGame = {
  slug: "g",
  status: "published",
  manualCaps: null,
  capsMode: null,
  features: {},
};

function view(): IntegrationView {
  return {
    provider: { id: "p1", name: "Estudio", webhookConfigured: false, apiKeys: 0 },
    providerLevel: { presence: null, social: null, webhooks: null },
    games: [
      // Sin credencial NGE ni señal NGP.
      { ...baseGame, id: "g1", title: "Sin nada", nostr: null, nge: null },
      // Credencial emitida, sin RPC: "esperando señal".
      {
        ...baseGame,
        id: "g2",
        title: "Esperando",
        nostr: null,
        nge: { issuedAt: recent(), rotatedAt: null, rpc: null, bets: null },
      },
      // NGE detectado + NGP con login inferido y presencia del probador.
      {
        ...baseGame,
        id: "g3",
        title: "Detectado",
        nostr: {
          scores: ping(recent()),
          login: ping(recent()),
          presence: ping(old()),
          zaps: null,
          comments: null,
          betsV2: ping(recent()),
          oracle: null,
        },
        nge: {
          issuedAt: old(),
          rotatedAt: recent(),
          rpc: ping(recent()),
          bets: ping(recent()),
        },
      },
    ],
  };
}

describe("IntegrationMatrix (verificación NGP + NGE)", () => {
  it("renderiza los tres estados NGE y las señales NGP nuevas", () => {
    // El SSR intercala separadores <!-- --> entre nodos de texto: se limpian
    // para poder asertar frases completas.
    const html = renderToString(<IntegrationMatrix view={view()} editable />).replace(
      /<!-- -->/g,
      "",
    );
    // Veredictos NGE por juego.
    expect(html).toContain("No configurado");
    expect(html).toContain("Esperando señal");
    expect(html).toContain("NGE · Detectado");
    // Panel NGE: credencial y evidencia.
    expect(html).toContain("Conexión NGE (RPC)");
    expect(html).toContain("Sin credencial emitida");
    expect(html).toContain("Último RPC recibido");
    expect(html).toContain("apuesta(s) creadas por NGE");
    // Handshake sugerido cuando falta señal.
    expect(html).toContain("get_info");
    // Sección de apuestas dentro del bloque NGE.
    expect(html).toContain("NGE · Apuestas y escrow");
  });

  it("no rompe con un juego sin ninguna evidencia (todo null)", () => {
    const v = view();
    v.games = [v.games[0]];
    expect(() => renderToString(<IntegrationMatrix view={v} />)).not.toThrow();
  });
});
