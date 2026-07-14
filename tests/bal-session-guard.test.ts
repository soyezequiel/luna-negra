import { beforeEach, describe, expect, it, vi } from "vitest";
import { BalSessionGuard } from "@/lib/bal-session-guard";

type BeforeUnloadHandler = (event: BeforeUnloadEvent) => void;

function fakeWindow() {
  let handler: BeforeUnloadHandler | null = null;
  return {
    window: {
      addEventListener: vi.fn((type: string, value: BeforeUnloadHandler) => {
        if (type === "beforeunload") handler = value;
      }),
      removeEventListener: vi.fn((type: string, value: BeforeUnloadHandler) => {
        if (type === "beforeunload" && handler === value) handler = null;
      }),
    } as unknown as Window,
    dispatch() {
      const event = {
        preventDefault: vi.fn(),
        returnValue: "",
      } as unknown as BeforeUnloadEvent;
      handler?.(event);
      return event;
    },
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("BalSessionGuard", () => {
  it("warns only while a BAL signer session is active", () => {
    const target = fakeWindow();
    const guard = new BalSessionGuard(target.window);
    guard.start();

    const before = target.dispatch();
    expect(before.preventDefault).not.toHaveBeenCalled();

    guard.observe({ type: "BAL_SESSION", requestId: "request-1", expiresAt: Date.now() + 60_000 });
    const active = target.dispatch();
    expect(active.preventDefault).toHaveBeenCalledOnce();
    expect(active.returnValue).toContain("firmante");

    guard.observe({ type: "BAL_LOGOUT", requestId: "request-1" });
    const after = target.dispatch();
    expect(after.preventDefault).not.toHaveBeenCalled();
    guard.stop();
  });
});

