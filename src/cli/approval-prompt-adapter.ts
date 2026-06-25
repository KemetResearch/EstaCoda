import type { ViewModel } from "../contracts/view-model.js";
import type { ToolExecutionRecord } from "../tools/tool-executor.js";
import { buildApprovalPromptViewModel } from "./tool-activity-view-models.js";

export type ApprovalPromptChrome = {
  readonly enabled: boolean;
  clearInlineSpinner(): void;
  suspendChromeForTranscript<T>(fn: () => T | Promise<T>): Promise<T>;
  suspendForPrompt?<T>(fn: () => T | Promise<T>): Promise<T>;
};

export type ApprovalPromptAdapterInput = {
  readonly prompt: (question: string) => Promise<string>;
  readonly output: Pick<NodeJS.WritableStream, "write">;
  readonly renderer: { render(viewModel: ViewModel): string };
  readonly chrome: ApprovalPromptChrome;
  readonly execution: ToolExecutionRecord;
  readonly allowPersistentApproval: boolean;
};

export type ApprovalPromptAdapter = (input: ApprovalPromptAdapterInput) => Promise<string>;

export const defaultApprovalPromptAdapter: ApprovalPromptAdapter = async (input) => {
  const promptText = "approval > ";
  const cardText = renderApprovalPromptCard(input.execution, input.renderer, input.allowPersistentApproval);
  if (input.chrome.suspendForPrompt !== undefined) {
    return await input.chrome.suspendForPrompt(async () => {
      input.output.write(`${cardText}\n`);
      return await input.prompt(promptText);
    });
  }

  input.chrome.clearInlineSpinner();
  if (input.chrome.enabled) {
    await input.chrome.suspendChromeForTranscript(() => {
      input.output.write(`${cardText}\n`);
    });
  } else {
    input.output.write(`${cardText}\n`);
  }
  return await input.prompt(promptText);
};

function renderApprovalPromptCard(
  execution: ToolExecutionRecord,
  renderer: { render(viewModel: ViewModel): string },
  allowPersistentApproval: boolean
): string {
  const vm = buildApprovalPromptViewModel(execution, { allowPersistentApproval });
  return renderer.render(vm);
}
