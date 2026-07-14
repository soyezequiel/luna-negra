import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyWithdrawToken } from "@/lib/auth";
import { decodeLnurl } from "@/lib/zap";
import { createWithdrawClaimLinks } from "@/lib/withdraw-claim";

describe("withdraw claim links", () => {
  it("crea una página de Luna y un LNURL para el mismo retiro", async () => {
    const links = await createWithdrawClaimLinks(
      "participant-1",
      new Date(Date.now() + 5 * 60_000),
      "https://luna.example/",
    );

    expect(links).not.toBeNull();
    if (!links) throw new Error("No se generaron links de retiro");
    expect(links.claimUrl).toBe(`https://luna.example/retiro/${links.token}`);
    expect(decodeLnurl(links.withdrawLnurl)).toBe(
      `https://luna.example/api/escrow/lnurlw/${links.token}`,
    );
    expect(await verifyWithdrawToken(links.token)).toBe("participant-1");
  });

  it("no emite links para un retiro vencido", async () => {
    await expect(
      createWithdrawClaimLinks(
        "participant-1",
        new Date(Date.now() - 1000),
        "https://luna.example",
      ),
    ).resolves.toBeNull();
  });
});
