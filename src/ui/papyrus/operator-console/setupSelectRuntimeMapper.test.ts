import { describe, expect, it } from "vitest";
import { mapSetupSelectToSetupPanelState } from "./setupSelectRuntimeMapper.js";

describe("Operator Console setup select runtime mapper", () => {
  it("maps provider/model/status/notes cells into a setup panel state", () => {
    const state = mapSetupSelectToSetupPanelState({
      title: "Model route",
      body: "Choose the active provider and model route.\n",
      selectedIndex: 1,
      options: [
        {
          id: "openai",
          label: "OpenAI",
          cells: {
            provider: "OpenAI",
            model: "gpt-5.5",
            status: "ready",
            notes: "API key set",
          },
        },
        {
          id: "local",
          label: "Local",
          cells: {
            provider: "Local",
            model: "qwen3-coder",
            status: "offline",
            notes: "endpoint unset",
          },
        },
      ],
    });

    expect(state).toEqual({
      kind: "table",
      title: "Model route",
      description: "Choose the active provider and model route.",
      locale: undefined,
      selectedRowId: "local",
      footer: "↑↓ navigate · Enter select · / filter · Esc back",
      rows: [
        { id: "openai", provider: "OpenAI", model: "gpt-5.5", status: "ready", notes: "API key set" },
        { id: "local", provider: "Local", model: "qwen3-coder", status: "offline", notes: "endpoint unset" },
      ],
    });
  });

  it("maps existing setup name/details cells without changing semantic option values", () => {
    const state = mapSetupSelectToSetupPanelState({
      title: "Primary provider",
      body: "Choose your primary model provider.\n",
      hint: "↑↓ navigate   ENTER select",
      selectedIndex: 0,
      options: [
        {
          id: "openai",
          label: "OpenAI",
          cells: {
            name: "OpenAI",
            details: "Hosted OpenAI models. API key required.",
          },
          current: true,
        },
      ],
    });

    expect(state?.rows).toEqual([
      {
        id: "openai",
        provider: "OpenAI",
        model: "",
        status: "Hosted OpenAI models. API key required.",
        notes: "current",
      },
    ]);
    expect(state?.footer).toBe("↑↓ navigate   ENTER select");
  });

  it("preserves Arabic copy and technical tokens", () => {
    const state = mapSetupSelectToSetupPanelState({
      title: "إعداد النموذج",
      body: "اختر مزود النموذج والمسار النشط.",
      locale: "ar",
      selectedIndex: 0,
      options: [
        {
          id: "openai",
          label: "OpenAI",
          cells: {
            provider: "OpenAI",
            model: "gpt-5.5",
            status: "جاهز",
            notes: "API key محفوظ",
          },
        },
        {
          id: "local",
          label: "Local",
          cells: {
            provider: "Local",
            model: "qwen3-coder",
            status: "غير متصل",
            notes: "URL غير مضبوط",
          },
        },
      ],
    });

    expect(state?.locale).toBe("ar");
    expect(state?.rows[0]).toMatchObject({
      provider: "OpenAI",
      model: "gpt-5.5",
      notes: "API key محفوظ",
    });
    expect(state?.rows[1]).toMatchObject({
      provider: "Local",
      model: "qwen3-coder",
      notes: "URL غير مضبوط",
    });
    expect(state?.footer).toContain("Enter");
    expect(state?.footer).toContain("Esc");
  });
});
