import type { Prompt } from "../../cli/readline-prompt.js";
import { promptSetupChoice } from "../setup-prompts.js";
import type { ConfigEditorRenderedAction } from "./render.js";

export async function promptConfigEditorAction(
  prompt: Prompt,
  actions: readonly ConfigEditorRenderedAction[],
  defaultActionId?: string
): Promise<ConfigEditorRenderedAction | undefined> {
  if (actions.length === 0) {
    return undefined;
  }

  const defaultAction = actions.find((action) => action.id === defaultActionId) ?? actions[0];
  return promptSetupChoice(prompt, {
    title: "Guided setup editor",
    message: "Choose a read-only setup action.\n",
    choices: actions.map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      value: action,
    })),
    defaultValue: defaultAction,
  });
}
