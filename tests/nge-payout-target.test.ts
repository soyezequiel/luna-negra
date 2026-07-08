import { describe, it, expect } from "vitest";
import { ngeSeatRealPubkey } from "@/lib/escrow-v2-payout";

// En NGE cada asiento envuelve al jugador en un invitado efímero (para el depósito
// custodial). El PAYOUT debe ir al jugador REAL (su pubkey, que el juego mandó y quedó
// en el seatsMeta), no al invitado — si no, el premio queda varado. `ngeSeatRealPubkey`
// recupera esa pubkey por el npub del invitado.
const REAL = "3c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1";
const meta = (seats: Array<{ npub: string; pubkey?: string }>) =>
  ({ metadataJson: JSON.stringify({ nge: { seats } }) });

describe("ngeSeatRealPubkey", () => {
  it("devuelve la pubkey real del jugador matcheando por el npub del invitado", () => {
    const bet = meta([
      { npub: "npub-guest-a", pubkey: REAL },
      { npub: "npub-guest-b" },
    ]);
    expect(ngeSeatRealPubkey(bet, "npub-guest-a")).toBe(REAL);
  });

  it("null si el asiento es anónimo (sin pubkey real) → cobra por QR", () => {
    const bet = meta([{ npub: "npub-guest-b" }]);
    expect(ngeSeatRealPubkey(bet, "npub-guest-b")).toBeNull();
  });

  it("null si el npub del invitado no está en el contrato", () => {
    const bet = meta([{ npub: "npub-guest-a", pubkey: REAL }]);
    expect(ngeSeatRealPubkey(bet, "npub-desconocido")).toBeNull();
  });

  it("null si la pubkey del asiento no es hex de 64", () => {
    const bet = meta([{ npub: "npub-guest-a", pubkey: "no-es-hex" }]);
    expect(ngeSeatRealPubkey(bet, "npub-guest-a")).toBeNull();
  });

  it("null para una apuesta NO-NGE (sin metadataJson.nge)", () => {
    expect(ngeSeatRealPubkey({ metadataJson: JSON.stringify({ other: 1 }) }, "x")).toBeNull();
    expect(ngeSeatRealPubkey({ metadataJson: null }, "x")).toBeNull();
    expect(ngeSeatRealPubkey({ metadataJson: "{ roto" }, "x")).toBeNull();
  });
});
