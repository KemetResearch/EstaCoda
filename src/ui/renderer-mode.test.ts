import { describe, expect, it } from "vitest";
import {
  parseUiRendererMode,
  resolveUiRendererMode,
  UI_RENDERER_ENV_VAR,
  UI_RENDERER_MODES,
  type UiRendererMode,
} from "./renderer-mode.js";

describe("UI renderer mode", () => {
  it("defaults unset values to legacy", () => {
    expect(resolveUiRendererMode({ env: {} })).toBe("legacy");
    expect(parseUiRendererMode(undefined)).toBe("legacy");
  });

  it("defaults empty values to legacy", () => {
    expect(parseUiRendererMode("")).toBe("legacy");
    expect(parseUiRendererMode("   ")).toBe("legacy");
  });

  it("accepts legacy", () => {
    expect(parseUiRendererMode("legacy")).toBe("legacy");
  });

  it("accepts papyrus", () => {
    expect(parseUiRendererMode("papyrus")).toBe("papyrus");
  });

  it("trims whitespace", () => {
    expect(parseUiRendererMode("  papyrus  ")).toBe("papyrus");
    expect(parseUiRendererMode("\nlegacy\t")).toBe("legacy");
  });

  it("accepts modes case-insensitively", () => {
    expect(parseUiRendererMode("PAPYRUS")).toBe("papyrus");
    expect(parseUiRendererMode("Legacy")).toBe("legacy");
  });

  it("falls back to legacy for invalid values", () => {
    expect(parseUiRendererMode("screen")).toBe("legacy");
    expect(parseUiRendererMode("papyrus-beta")).toBe("legacy");
  });

  it("resolves ESTACODA_UI_RENDERER from a passed env object", () => {
    expect(resolveUiRendererMode({ env: { [UI_RENDERER_ENV_VAR]: "papyrus" } })).toBe("papyrus");
  });

  it("does not mutate env objects", () => {
    const env = { [UI_RENDERER_ENV_VAR]: " papyrus " };
    const before = { ...env };
    expect(resolveUiRendererMode({ env })).toBe("papyrus");
    expect(env).toEqual(before);
  });

  it("exports only the narrow supported modes", () => {
    const modes = [...UI_RENDERER_MODES] satisfies UiRendererMode[];
    expect(modes).toEqual(["legacy", "papyrus"]);
  });
});
