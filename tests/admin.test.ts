import { describe, it, expect, afterEach } from "vitest";
import { isAdmin } from "@/lib/admin";

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
