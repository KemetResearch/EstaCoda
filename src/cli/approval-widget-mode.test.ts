import { describe, expect, it } from "vitest";
import {
  APPROVAL_WIDGET_MODE_ENV_VAR,
  APPROVAL_WIDGET_MODES,
  parseApprovalWidgetMode,
  resolveCoreSessionApprovalWidgetMode,
  resolveApprovalWidgetMode,
  type ApprovalWidgetMode,
} from "./approval-widget-mode.js";

describe("approval widget mode", () => {
  it("covers the rollout matrix for Papyrus cards and plain fallback overrides", () => {
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "raw",
      rendererMode: "papyrus",
    })).toBe("papyrus");
    expect(resolveCoreSessionApprovalWidgetMode({
      env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "legacy" },
      inputMode: "raw",
      rendererMode: "papyrus",
    })).toBe("legacy");
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "readline",
      rendererMode: "papyrus",
    })).toBe("legacy");
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "raw",
      rendererMode: "legacy",
    })).toBe("legacy");
  });

  it("defaults unset values to legacy", () => {
    expect(resolveApprovalWidgetMode({ env: {} })).toBe("legacy");
    expect(parseApprovalWidgetMode(undefined)).toBe("legacy");
  });

  it("defaults empty values to legacy", () => {
    expect(parseApprovalWidgetMode("")).toBe("legacy");
    expect(parseApprovalWidgetMode("   ")).toBe("legacy");
  });

  it("accepts legacy", () => {
    expect(parseApprovalWidgetMode("legacy")).toBe("legacy");
  });

  it("accepts papyrus", () => {
    expect(parseApprovalWidgetMode("papyrus")).toBe("papyrus");
  });

  it("trims whitespace", () => {
    expect(parseApprovalWidgetMode("  papyrus  ")).toBe("papyrus");
    expect(parseApprovalWidgetMode("\nlegacy\t")).toBe("legacy");
  });

  it("accepts modes case-insensitively", () => {
    expect(parseApprovalWidgetMode("PAPYRUS")).toBe("papyrus");
    expect(parseApprovalWidgetMode("Legacy")).toBe("legacy");
  });

  it("falls back to legacy for invalid values", () => {
    expect(parseApprovalWidgetMode("raw")).toBe("legacy");
    expect(parseApprovalWidgetMode("papyrus-beta")).toBe("legacy");
  });

  it("can use papyrus as an injected default for raw Papyrus core sessions", () => {
    expect(resolveApprovalWidgetMode({ env: {}, defaultMode: "papyrus" })).toBe("papyrus");
    expect(parseApprovalWidgetMode(undefined, "papyrus")).toBe("papyrus");
    expect(parseApprovalWidgetMode("", "papyrus")).toBe("papyrus");
    expect(parseApprovalWidgetMode("invalid", "papyrus")).toBe("papyrus");
  });

  it("keeps explicit legacy as an escape hatch when papyrus is the default", () => {
    expect(resolveApprovalWidgetMode({
      env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "legacy" },
      defaultMode: "papyrus",
    })).toBe("legacy");
  });

  it("defaults raw Papyrus core sessions to papyrus approval widgets", () => {
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "raw",
      rendererMode: "papyrus",
    })).toBe("papyrus");
  });

  it("preserves legacy approval prompts for readline or legacy renderer fallback sessions", () => {
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "readline",
      rendererMode: "papyrus",
    })).toBe("legacy");
    expect(resolveCoreSessionApprovalWidgetMode({
      env: {},
      inputMode: "raw",
      rendererMode: "legacy",
    })).toBe("legacy");
  });

  it("keeps readline and legacy renderer fallback gates above explicit Papyrus approval widgets", () => {
    expect(resolveCoreSessionApprovalWidgetMode({
      env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "papyrus" },
      inputMode: "readline",
      rendererMode: "papyrus",
    })).toBe("legacy");
    expect(resolveCoreSessionApprovalWidgetMode({
      env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "papyrus" },
      inputMode: "raw",
      rendererMode: "legacy",
    })).toBe("legacy");
  });

  it("keeps explicit legacy as the core session approval widget escape hatch", () => {
    expect(resolveCoreSessionApprovalWidgetMode({
      env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "legacy" },
      inputMode: "raw",
      rendererMode: "papyrus",
    })).toBe("legacy");
  });

  it("resolves ESTACODA_APPROVAL_WIDGETS from a passed env object", () => {
    expect(resolveApprovalWidgetMode({ env: { [APPROVAL_WIDGET_MODE_ENV_VAR]: "papyrus" } })).toBe("papyrus");
  });

  it("does not mutate env objects", () => {
    const env = { [APPROVAL_WIDGET_MODE_ENV_VAR]: " papyrus " };
    const before = { ...env };
    expect(resolveApprovalWidgetMode({ env })).toBe("papyrus");
    expect(env).toEqual(before);
  });

  it("exports only the narrow supported modes", () => {
    const modes = [...APPROVAL_WIDGET_MODES] satisfies ApprovalWidgetMode[];
    expect(modes).toEqual(["legacy", "papyrus"]);
  });
});
