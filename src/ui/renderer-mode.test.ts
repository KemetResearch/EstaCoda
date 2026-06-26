import { describe, expect, it } from "vitest";
import {
  parseUiRendererMode,
  resolveUiRendererMode,
  UI_RENDERER_ENV_VAR,
  UI_RENDERER_MODES,
  type UiRendererMode,
} from "./renderer-mode.js";

describe("UI renderer mode", () => {
  it("covers the rollout matrix default and explicit legacy override", () => {
    expect(resolveUiRendererMode({ env: {} })).toBe("papyrus");
    expect(resolveUiRendererMode({ env: { [UI_RENDERER_ENV_VAR]: "legacy" } })).toBe("legacy");
  });

  it("defaults unset values to papyrus", () => {
    expect(resolveUiRendererMode({ env: {} })).toBe("papyrus");
    expect(parseUiRendererMode(undefined)).toBe("papyrus");
  });

  it("defaults empty values to papyrus", () => {
    expect(parseUiRendererMode("")).toBe("papyrus");
    expect(parseUiRendererMode("   ")).toBe("papyrus");
  });

  it("accepts explicit legacy as an escape hatch", () => {
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

  it("falls back to papyrus for invalid values", () => {
    expect(parseUiRendererMode("screen")).toBe("papyrus");
    expect(parseUiRendererMode("papyrus-beta")).toBe("papyrus");
  });

  it("resolves ESTACODA_UI_RENDERER from a passed env object", () => {
    expect(resolveUiRendererMode({ env: { [UI_RENDERER_ENV_VAR]: "papyrus" } })).toBe("papyrus");
    expect(resolveUiRendererMode({ env: { [UI_RENDERER_ENV_VAR]: "legacy" } })).toBe("legacy");
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
