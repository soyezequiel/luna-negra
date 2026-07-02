import { describe, expect, it } from "vitest";
import { latestJoinableInviteId } from "@/lib/invite";

// Mensaje mínimo con la forma que consume el helper.
type M = { id: string; fromMe: boolean; text: string; gameUrl?: string };
const nip04Invite = (id: string, fromMe = false): M => ({
  id,
  fromMe,
  text: "Te invito a jugar Tetra en Luna Negra\nhttps://luna.example/game/tetra?room=ROOM1",
});
const nip17Reto = (id: string, fromMe = false): M => ({
  id,
  fromMe,
  text: "Te reto a una partida de TETRA.",
  gameUrl: "https://tetra.example/?join=ROOM1",
});
const plain = (id: string, fromMe = false): M => ({ id, fromMe, text: "hola" });

describe("latestJoinableInviteId", () => {
  it("sin invitaciones devuelve null", () => {
    expect(latestJoinableInviteId([plain("a"), plain("b")])).toBeNull();
  });

  it("elige la última invitación NIP-04 recibida", () => {
    expect(
      latestJoinableInviteId([nip04Invite("i1"), plain("m"), nip04Invite("i2")]),
    ).toBe("i2");
  });

  it("elige el último reto NIP-17 recibido", () => {
    expect(latestJoinableInviteId([nip17Reto("r1"), nip17Reto("r2")])).toBe("r2");
  });

  it("la más nueva gana sin importar el tipo (NIP-04 vs NIP-17)", () => {
    expect(
      latestJoinableInviteId([nip04Invite("i1"), nip17Reto("r1")]),
    ).toBe("r1");
    expect(
      latestJoinableInviteId([nip17Reto("r1"), nip04Invite("i1")]),
    ).toBe("i1");
  });

  it("ignora las invitaciones que envié yo (fromMe)", () => {
    expect(
      latestJoinableInviteId([nip17Reto("r1"), nip17Reto("mine", true)]),
    ).toBe("r1");
  });

  it("un mensaje de texto posterior no invalida la última invitación", () => {
    expect(latestJoinableInviteId([nip17Reto("r1"), plain("m")])).toBe("r1");
  });
});
