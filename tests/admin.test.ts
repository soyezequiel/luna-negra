import { describe, it, expect, afterEach } from "vitest";
import { isAdmin, canViewHiddenGame } from "@/lib/admin";

describe("isAdmin", () => {
  const original = process.env.ADMIN_PUBKEY;
  afterEach(() => {
    process.env.ADMIN_PUBKEY = original;
  });

  it("false sin pubkey", () => {
    expect(isAdmin(undefined)).toBe(false);
  });

  it("compara contra ADMIN_PUBKEY (case-insensitive)", () => {
    process.env.ADMIN_PUBKEY = "ABCDEF";
    expect(isAdmin("abcdef")).toBe(true);
    expect(isAdmin("999999")).toBe(false);
  });
});

describe("canViewHiddenGame", () => {
  const original = process.env.ADMIN_PUBKEY;
  afterEach(() => {
    process.env.ADMIN_PUBKEY = original;
  });

  it("el admin puede ver cualquier juego oculto", () => {
    process.env.ADMIN_PUBKEY = "ADMIN";
    expect(canViewHiddenGame("admin", "u_otro", "owner_id")).toBe(true);
  });

  it("el proveedor dueño puede ver su juego oculto", () => {
    process.env.ADMIN_PUBKEY = "ADMIN";
    expect(canViewHiddenGame("nopubkey", "owner_id", "owner_id")).toBe(true);
  });

  it("un usuario cualquiera no puede verlo", () => {
    process.env.ADMIN_PUBKEY = "ADMIN";
    expect(canViewHiddenGame("nopubkey", "u_otro", "owner_id")).toBe(false);
    expect(canViewHiddenGame(undefined, undefined, "owner_id")).toBe(false);
  });
});
