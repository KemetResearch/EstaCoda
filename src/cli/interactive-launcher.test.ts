import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { launchInteractiveSession } from "./interactive-launcher.js";

describe("launchInteractiveSession", () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true
    });
    vi.restoreAllMocks();
  });

  it("returns error when not in a TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true
    });

    const result = await launchInteractiveSession({ workspaceRoot: process.cwd() });
    expect(result.launched).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("requires a TTY");
  });
});
