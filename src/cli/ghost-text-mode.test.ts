import { describe, expect, it } from "vitest";
import {
  GHOST_TEXT_ENV_VAR,
  parseGhostTextMode,
  resolveGhostTextMode,
} from "./ghost-text-mode.js";

describe("ghost text mode", () => {
  it("defaults unset, empty, invalid, zero, and false values to off", () => {
    expect(resolveGhostTextMode({ env: {} })).toBe("off");
    expect(parseGhostTextMode(undefined)).toBe("off");
    expect(parseGhostTextMode("")).toBe("off");
    expect(parseGhostTextMode("   ")).toBe("off");
    expect(parseGhostTextMode("0")).toBe("off");
    expect(parseGhostTextMode("false")).toBe("off");
    expect(parseGhostTextMode("papyrus")).toBe("off");
  });

  it("accepts explicit on values", () => {
    expect(parseGhostTextMode("1")).toBe("on");
    expect(parseGhostTextMode("true")).toBe("on");
    expect(parseGhostTextMode("on")).toBe("on");
    expect(parseGhostTextMode(" ON ")).toBe("on");
  });

  it("resolves ESTACODA_GHOST_TEXT from an injected env object without mutation", () => {
    const env = { [GHOST_TEXT_ENV_VAR]: " true " };
    const before = { ...env };

    expect(resolveGhostTextMode({ env })).toBe("on");
    expect(env).toEqual(before);
  });
});
