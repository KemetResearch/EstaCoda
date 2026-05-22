import { describe, expect, it } from "vitest";
import {
  MODEL_PICKER_ACTION_VALUE_LIMIT,
  MODEL_PICKER_MAX_CHOICE_ACTIONS,
  modelPickerCancelActionValue,
  modelPickerClearActionValue,
  modelPickerProviderActionKey,
  modelPickerProviderActionValue,
  modelPickerSelectActionKey,
  modelPickerSelectActionValue,
  parseModelPickerAction,
  renderModelPickerActions
} from "./model-picker-actions.js";

describe("model picker actions", () => {
  it("round-trips ecmodel1 provider, select, clear, and cancel actions", () => {
    const providerKey = modelPickerProviderActionKey("openrouter");
    const provider = parseModelPickerAction(modelPickerProviderActionValue(providerKey));
    expect(provider).toEqual({
      ok: true,
      action: {
        kind: "provider",
        actionKey: providerKey
      }
    });

    const selectKey = modelPickerSelectActionKey("openrouter", "openai/gpt-4o");
    const select = parseModelPickerAction(modelPickerSelectActionValue(selectKey));
    expect(select).toEqual({
      ok: true,
      action: {
        kind: "select",
        actionKey: selectKey
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
      reason: "Invalid model picker action key."
    });
    expect(parseModelPickerAction("ecmodel1:s:not.a.route")).toEqual({
      ok: false,
      reason: "Invalid model picker action key."
    });
  });

  it("renders compact action payloads without raw credential values", () => {
    const actions = renderModelPickerActions([
      { label: "OpenAI", actionKey: modelPickerProviderActionKey("openai"), kind: "provider" },
      {
        label: "a very long model label",
        actionKey: modelPickerSelectActionKey(
          "openai",
          "a".repeat(180)
        ),
        kind: "select"
      }
    ]);

    const serialized = JSON.stringify(actions);
    for (const action of actions.flat()) {
      expect(action.value.length).toBeLessThanOrEqual(MODEL_PICKER_ACTION_VALUE_LIMIT);
      expect(action.value).not.toContain("openai/");
      expect(action.value).not.toContain("a".repeat(60));
    }
    expect(serialized).toContain("ecmodel1:p:");
    expect(serialized).toContain("ecmodel1:s:");
    expect(serialized).toContain("ecmodel1:c");
    expect(serialized).toContain("ecmodel1:x");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("OPENAI_API_KEY=");
    expect(serialized).not.toContain("Bearer ");
  });

  it("caps rendered picker choices to safe channel component limits", () => {
    const actions = renderModelPickerActions(
      Array.from({ length: MODEL_PICKER_MAX_CHOICE_ACTIONS + 10 }, (_, index) => ({
        label: `Provider ${index}`,
        actionKey: modelPickerProviderActionKey(`provider-${index}`),
        kind: "provider" as const
      }))
    );

    expect(actions).toHaveLength(5);
    expect(actions.flat()).toHaveLength(MODEL_PICKER_MAX_CHOICE_ACTIONS + 2);
    expect(actions.at(-1)?.map((action) => action.label)).toEqual(["Clear", "Cancel"]);
  });
});
