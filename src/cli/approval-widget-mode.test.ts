import { describe, expect, it } from "vitest";
import {
  APPROVAL_WIDGET_MODE_ENV_VAR,
  APPROVAL_WIDGET_MODES,
  parseApprovalWidgetMode,
  resolveApprovalWidgetMode,
  type ApprovalWidgetMode,
} from "./approval-widget-mode.js";

describe("approval widget mode", () => {
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
