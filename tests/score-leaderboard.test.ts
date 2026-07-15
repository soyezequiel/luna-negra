import { describe, expect, it } from "vitest";
import {
  authenticatedStanding,
  type ScoreStanding,
} from "@/lib/score-leaderboard";

const standing: ScoreStanding = {
  board: "victorias",
  score: 12,
  rank: 4,
  total: 30,
  viaNostr: true,
};

describe("marcador al cambiar la sesión", () => {
  it("oculta un puesto propio viejo durante el render de logout", () => {
    expect(
      authenticatedStanding(null, "victorias", {
        npub: "npub1anterior",
        byBoard: { victorias: standing },
      }),
    ).toBeNull();
  });

  it("no muestra el puesto de la cuenta anterior al cambiar de usuario", () => {
    expect(
      authenticatedStanding({ npub: "npub1nuevo" }, "victorias", {
        npub: "npub1anterior",
        byBoard: { victorias: standing },
      }),
    ).toBeNull();
  });

  it("muestra el puesto propio mientras la sesión sigue activa", () => {
    expect(
      authenticatedStanding(
        { npub: "npub1jugador" },
        "victorias",
        {
          npub: "npub1jugador",
          byBoard: { victorias: standing },
        },
      ),
    ).toBe(standing);
  });
});
