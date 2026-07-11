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
    // Capacidades gestionadas por la tienda (zaps, reseñas) van en su propia
    // sección contraída, separadas de lo que el dev sí integra.
    expect(html).toContain("Gestionado por la tienda");
    expect(html).toContain("Propinas y premios");
    expect(html).toContain("Reseñas y logros");
    // La presencia se detecta sola (job en background): ya no se declara a mano,
    // así que su checkbox no debe renderizarse ni siquiera en modo editable.
    expect(html).not.toContain("Declaro que uso la presencia en vivo");
    // Las capacidades genuinamente inobservables SÍ conservan su checkbox.
    // "Invitaciones" ahora representa Room Link (la clave que habilita «Invitar»).
    expect(html).toContain("Declaro que integré Room Link");
    expect(html).toContain("Invitaciones (Room Link)");
    // Ya no existe la declaración de invitaciones NIP-17 ni la de amigos.
    expect(html).not.toContain("Declaro que integré invitaciones Nostr");
    // Salas NIP-29 se removió del catálogo NGP: su checkbox no debe existir.
    expect(html).not.toContain("Declaro que integré salas Nostr");
  });

  it("no rompe con un juego sin ninguna evidencia (todo null)", () => {
    const v = view();
    v.games = [v.games[0]];
    expect(() => renderToString(<IntegrationMatrix view={v} />)).not.toThrow();
  });

  it("oculta el checkbox de login cuando ya se infiere del marcador", () => {
    const v = view();
    v.games = [v.games[2]]; // solo el juego con login inferido (scores + login)
    const html = renderToString(<IntegrationMatrix view={v} editable />).replace(
      /<!-- -->/g,
      "",
    );
    // Login "en uso" (inferido): su checkbox de declaración manual sobra y se oculta.
    expect(html).not.toContain("Declaro que integré el login Nostr");
    // Room Link (nunca observable) SÍ conserva su checkbox aunque no haya evidencia.
    expect(html).toContain("Declaro que integré Room Link");
  });
});
