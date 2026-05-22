import type { ChannelTextAction } from "../contracts/channel.js";
import { createHash } from "node:crypto";

const ACTION_PREFIX = "ecmodel1";
export const MODEL_PICKER_ACTION_VALUE_LIMIT = 64;
export const MODEL_PICKER_MAX_CHOICE_ACTIONS = 20;
const ACTION_KEY_PATTERN = /^[A-Za-z0-9_-]{8,24}$/u;

export type ModelPickerAction =
  | { kind: "provider"; actionKey: string }
  | { kind: "select"; actionKey: string }
  | { kind: "clear" }
  | { kind: "cancel" };

export type ModelPickerActionParseResult =
  | { ok: true; action: ModelPickerAction }
  | { ok: false; reason: string };

export type ModelPickerChoice = {
  label: string;
  actionKey: string;
  kind: "provider" | "select";
};

export function modelPickerProviderActionKey(provider: string): string {
  return compactActionKey(["provider", provider]);
}

export function modelPickerSelectActionKey(provider: string, model: string): string {
  return compactActionKey(["model", provider, model]);
}

export function modelPickerProviderActionValue(actionKey: string): string {
  return [ACTION_PREFIX, "p", actionKey].join(":");
}

export function modelPickerSelectActionValue(actionKey: string): string {
  return [ACTION_PREFIX, "s", actionKey].join(":");
}

export function modelPickerClearActionValue(): string {
  return [ACTION_PREFIX, "c"].join(":");
}

export function modelPickerCancelActionValue(): string {
  return [ACTION_PREFIX, "x"].join(":");
}

export function renderModelPickerActions(choices: ModelPickerChoice[]): ChannelTextAction[][] {
  const rows: ChannelTextAction[][] = [];
  const cappedChoices = choices.slice(0, MODEL_PICKER_MAX_CHOICE_ACTIONS);
  for (let index = 0; index < cappedChoices.length; index += 5) {
    rows.push(cappedChoices.slice(index, index + 5).map((choice) => ({
      label: choice.label,
      value: choice.kind === "provider"
        ? modelPickerProviderActionValue(choice.actionKey)
        : modelPickerSelectActionValue(choice.actionKey)
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
  if (action === "p" && parts.length === 3) {
    const actionKey = parts[2] ?? "";
    if (!isValidActionKey(actionKey)) {
      return { ok: false, reason: "Invalid model picker action key." };
    }
    return { ok: true, action: { kind: "provider", actionKey } };
  }
  if (action === "c" && parts.length === 2) {
    return { ok: true, action: { kind: "clear" } };
  }
  if (action === "x" && parts.length === 2) {
    return { ok: true, action: { kind: "cancel" } };
  }
  if (action !== "s" || parts.length !== 3) {
    return { ok: false, reason: "Invalid model picker action payload." };
  }

  const actionKey = parts[2] ?? "";
  if (!isValidActionKey(actionKey)) {
    return { ok: false, reason: "Invalid model picker action key." };
  }

  return {
    ok: true,
    action: {
      kind: "select",
      actionKey
    }
  };
}

function compactActionKey(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\0"))
    .digest("base64url")
    .slice(0, 12);
}

function isValidActionKey(value: string): boolean {
  return ACTION_KEY_PATTERN.test(value) &&
    [ACTION_PREFIX, "s", value].join(":").length <= MODEL_PICKER_ACTION_VALUE_LIMIT;
}
