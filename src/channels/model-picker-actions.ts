import type { ChannelTextAction } from "../contracts/channel.js";

const ACTION_PREFIX = "ecmodel1";

export type ModelPickerAction =
  | { kind: "select"; modelInput: string }
  | { kind: "clear" }
  | { kind: "cancel" };

export type ModelPickerActionParseResult =
  | { ok: true; action: ModelPickerAction }
  | { ok: false; reason: string };

export type ModelPickerChoice = {
  label: string;
  modelInput: string;
};

export function modelPickerSelectActionValue(modelInput: string): string {
  return [ACTION_PREFIX, "s", encodeURIComponent(modelInput)].join(":");
}

export function modelPickerClearActionValue(): string {
  return [ACTION_PREFIX, "c"].join(":");
}

export function modelPickerCancelActionValue(): string {
  return [ACTION_PREFIX, "x"].join(":");
}

export function renderModelPickerActions(choices: ModelPickerChoice[]): ChannelTextAction[][] {
  const rows: ChannelTextAction[][] = [];
  for (let index = 0; index < choices.length; index += 2) {
    rows.push(choices.slice(index, index + 2).map((choice) => ({
      label: choice.label,
      value: modelPickerSelectActionValue(choice.modelInput)
    })));
  }

  rows.push([
    { label: "Clear", value: modelPickerClearActionValue() },
    { label: "Cancel", value: modelPickerCancelActionValue() }
  ]);

  return rows;
}

export function parseModelPickerAction(value: string): ModelPickerActionParseResult | undefined {
  const parts = value.trim().split(":");
  if (parts[0] !== ACTION_PREFIX) {
    return undefined;
  }

  const action = parts[1];
  if (action === "c" && parts.length === 2) {
    return { ok: true, action: { kind: "clear" } };
  }
  if (action === "x" && parts.length === 2) {
    return { ok: true, action: { kind: "cancel" } };
  }
  if (action !== "s" || parts.length !== 3) {
    return { ok: false, reason: "Invalid model picker action payload." };
  }

  let modelInput: string;
  try {
    modelInput = decodeURIComponent(parts[2] ?? "");
  } catch {
    return { ok: false, reason: "Invalid model picker action encoding." };
  }

  if (modelInput.trim().length === 0 || !modelInput.includes("/")) {
    return { ok: false, reason: "Invalid model picker route." };
  }

  return {
    ok: true,
    action: {
      kind: "select",
      modelInput
    }
  };
}

