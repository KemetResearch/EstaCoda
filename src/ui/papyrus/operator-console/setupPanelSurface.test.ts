import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  renderSetupPanelSurface,
  type SecretEntryPanelState,
  type SetupPanelState,
} from "./index.js";

describe("Papyrus operator console setup panel surface", () => {
  it("renders provider/model table with measured columns and selected row at wide width", () => {
    const output = renderSetupPanelSurface(modelRoutePanel(), { width: 72 });
    const text = output.join("\n");

    expect(output[0]).toContain("Model route");
    expect(text).toContain("Choose the active provider and model route.");
    expect(text).toContain("Provider");
    expect(text).toContain("Model");
    expect(text).toContain("Status");
    expect(text).toContain("Notes");
    expect(text).toContain("❯");
    expect(text).toContain("OpenAI");
    expect(text).toContain("gpt-5.5");
    expect(text).toContain("ready");
    expect(text).toContain("API key set");
    expect(text).toContain("↑↓ navigate · Enter select · / filter · Esc back");
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("renders compact provider/model fallback under narrow width", () => {
    const output = renderSetupPanelSurface(modelRoutePanel(), { width: 44 });
    const text = output.join("\n");

    expect(text).toContain("❯ OpenAI");
    expect(text).toContain("gpt-5.5");
    expect(text).toContain("ready · API key set");
    expect(output.every((line) => stringWidth(line) <= 44)).toBe(true);
  });

  it("truncates long provider, model, status, and notes safely", () => {
    const output = renderSetupPanelSurface({
      ...modelRoutePanel(),
      rows: [{
        id: "long",
        provider: "VeryLongProviderName",
        model: "very-long-model-name-with-routing-suffix",
        status: "ready-with-extra-detail",
        notes: "API key set with a very long diagnostic note",
      }],
      selectedRowId: "long",
    }, { width: 42 });
    const text = output.join("\n");

    expect(text).not.toContain("routing-suffix");
    expect(text).not.toContain("very long diagnostic note");
    expect(output.every((line) => stringWidth(line) <= 42)).toBe(true);
  });

  it("renders Arabic setup labels while preserving technical tokens", () => {
    const output = renderSetupPanelSurface({
      kind: "table",
      title: "إعداد النموذج",
      locale: "ar",
      rows: [
        { id: "openai", provider: "OpenAI", model: "gpt-5.5", status: "جاهز", notes: "المفتاح محفوظ" },
        { id: "local", provider: "Local", model: "qwen3-coder", status: "غير متصل", notes: "URL غير مضبوط" },
      ],
      selectedRowId: "openai",
    }, { width: 72 });
    const text = output.join("\n");

    expect(text).toContain("إعداد النموذج");
    expect(text).toContain("المزود");
    expect(text).toContain("النموذج");
    expect(text).toContain("الحالة");
    expect(text).toContain("OpenAI");
    expect(text).toContain("gpt-5.5");
    expect(text).toContain("Local");
    expect(text).toContain("qwen3-coder");
    expect(text).toContain("URL");
    expect(text).toContain("Enter");
    expect(text).toContain("Esc");
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("renders required API key panel with masked value and env var only", () => {
    const output = renderSetupPanelSurface(requiredSecretPanel(), { width: 72 });
    const text = output.join("\n");

    expect(text).toContain("API key · OpenAI");
    expect(text).toContain("Enter API key for OpenAI.");
    expect(text).toContain("sk-••••••••••••••••");
    expect(text).toContain("Stored as: OPENAI_API_KEY");
    expect(text).toContain("Enter save · Esc back · Ctrl+C exit");
    expect(text).not.toContain("sk-live-raw-secret");
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("renders optional local key panel with leave-empty state", () => {
    const output = renderSetupPanelSurface({
      kind: "secret",
      title: "API key · Local",
      description: "API key is optional for this endpoint.",
      optional: true,
      emptyLabel: "[leave empty]",
      footer: "Enter continue without key · Esc back",
    }, { width: 72 });
    const text = output.join("\n");

    expect(text).toContain("API key is optional for this endpoint.");
    expect(text).toContain("[leave empty]");
    expect(text).toContain("Enter continue without key · Esc back");
  });

  it("never renders raw secret when raw value is modeled without a masked value", () => {
    const output = renderSetupPanelSurface({
      ...requiredSecretPanel(),
      maskedValue: undefined,
      rawValue: "sk-live-raw-secret",
    }, { width: 72 });
    const text = output.join("\n");

    expect(text).not.toContain("sk-live-raw-secret");
    expect(text).toContain("••••••••");
  });

  it("emits no ANSI/cursor-control strings and does not mutate setup state", () => {
    const state = modelRoutePanel();
    const before = JSON.stringify(state);
    const output = [
      ...renderSetupPanelSurface(state, { width: 72 }),
      ...renderSetupPanelSurface(requiredSecretPanel(), { width: 72 }),
    ].join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("\\033");
    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/u);
    expect(JSON.stringify(state)).toBe(before);
  });
});

function modelRoutePanel(): SetupPanelState {
  return {
    kind: "table",
    title: "Model route",
    description: "Choose the active provider and model route.",
    rows: [
      { id: "openai", provider: "OpenAI", model: "gpt-5.5", status: "ready", notes: "API key set" },
      { id: "anthropic", provider: "Anthropic", model: "claude-sonnet-4.5", status: "ready", notes: "API key set" },
      { id: "local", provider: "Local", model: "qwen3-coder", status: "offline", notes: "endpoint unset" },
      { id: "zai", provider: "Z.AI", model: "glm-4.5", status: "ready", notes: "API key set" },
    ],
    selectedRowId: "openai",
  };
}

function requiredSecretPanel(): SecretEntryPanelState {
  return {
    kind: "secret",
    title: "API key · OpenAI",
    description: "Enter API key for OpenAI.",
    maskedValue: "sk-••••••••••••••••",
    rawValue: "sk-live-raw-secret",
    envVar: "OPENAI_API_KEY",
    footer: "Enter save · Esc back · Ctrl+C exit",
  };
}
