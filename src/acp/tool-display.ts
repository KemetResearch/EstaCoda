import { buildToolDisplayPreview } from "../tools/tool-target-summary.js";
import { formatToolDisplayCall } from "../ui/tool-display.js";

export type AcpToolDisplayExecution = {
  readonly tool: { readonly name: string };
  readonly input?: Record<string, unknown>;
  readonly targetSummary?: string;
};

export function acpToolExecutionTitle(execution: AcpToolDisplayExecution): string {
  const preview = execution.input === undefined
    ? execution.targetSummary
    : buildToolDisplayPreview(execution.tool.name, execution.input) ?? execution.targetSummary;
  return formatToolDisplayCall({
    tool: execution.tool.name,
    preview,
  });
}
