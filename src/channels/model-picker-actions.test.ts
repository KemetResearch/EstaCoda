import { describe, expect, it } from "vitest";
import {
  modelPickerCancelActionValue,
  modelPickerClearActionValue,
  modelPickerSelectActionValue,
  parseModelPickerAction,
  renderModelPickerActions
} from "./model-picker-actions.js";

describe("model picker actions", () => {
  it("round-trips ecmodel1 select, clear, and cancel actions", () => {
    const select = parseModelPickerAction(modelPickerSelectActionValue("openrouter/openai/gpt-4o"));
    expect(select).toEqual({
      ok: true,
      action: {
        kind: "select",
        modelInput: "openrouter/openai/gpt-4o"
      }
    });

    expect(parseModelPickerAction(modelPickerClearActionValue())).toEqual({
      ok: true,
      action: { kind: "clear" }
    });
    expect(parseModelPickerAction(modelPickerCancelActionValue())).toEqual({
      ok: true,
      action: { kind: "cancel" }
    });
  });

  it("rejects invalid or malformed action payloads safely", () => {
    expect(parseModelPickerAction("not-model-action")).toBeUndefined();
    expect(parseModelPickerAction("ecmodel1")).toEqual({
      ok: false,
      reason: "Invalid model picker action payload."
    });
    expect(parseModelPickerAction("ecmodel1:s:")).toEqual({
      ok: false,
      reason: "Invalid model picker route."
    });
    expect(parseModelPickerAction("ecmodel1:s:not-a-route")).toEqual({
      ok: false,
      reason: "Invalid model picker route."
    });
    expect(parseModelPickerAction("ecmodel1:s:%E0%A4%A")).toEqual({
      ok: false,
      reason: "Invalid model picker action encoding."
    });
  });

  it("renders action payloads without raw credential values", () => {
    const actions = renderModelPickerActions([
      { label: "openai/gpt-4o", modelInput: "openai/gpt-4o" },
      { label: "local/phi4:latest", modelInput: "local/phi4:latest" }
    ]);

    const serialized = JSON.stringify(actions);
    expect(serialized).toContain("ecmodel1:s:");
    expect(serialized).toContain("ecmodel1:c");
    expect(serialized).toContain("ecmodel1:x");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("OPENAI_API_KEY=");
    expect(serialized).not.toContain("Bearer ");
  });
});

