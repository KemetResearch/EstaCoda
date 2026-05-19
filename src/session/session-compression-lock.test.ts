import { describe, expect, it } from "vitest";
import { SessionCompressionLock } from "./session-compression-lock.js";

describe("SessionCompressionLock", () => {
  it("serializes operations for the same session", async () => {
    const lock = new SessionCompressionLock();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = lock.runExclusive("session-1", async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-end");
    });
    const second = lock.runExclusive("session-1", async () => {
      order.push("second-start");
    });

    await waitFor(() => order.length === 1);
    expect(order).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("does not block unrelated sessions", async () => {
    const lock = new SessionCompressionLock();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = lock.runExclusive("session-1", async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-end");
    });
    const second = lock.runExclusive("session-2", async () => {
      order.push("second-start");
    });

    await second;
    expect(order).toEqual(["first-start", "second-start"]);

    releaseFirst();
    await first;
  });

  it("releases after failure", async () => {
    const lock = new SessionCompressionLock();

    await expect(lock.runExclusive("session-1", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    await expect(lock.runExclusive("session-1", async () => "ok")).resolves.toBe("ok");
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
