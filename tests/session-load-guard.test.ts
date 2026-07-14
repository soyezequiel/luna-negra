import { describe, expect, it } from "vitest";
import { createSessionLoadGuard } from "@/lib/session-load-guard";

describe("session load guard", () => {
  it("descarta una respuesta inicial que llega después de un login", () => {
    const guard = createSessionLoadGuard();
    const initialRequest = guard.snapshot();

    guard.invalidate();

    expect(guard.isCurrent(initialRequest)).toBe(false);
    expect(guard.isCurrent(guard.snapshot())).toBe(true);
  });
});
