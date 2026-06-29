import { buildToolDisplayPreview } from "../tools/tool-target-summary.js";
import { formatToolDisplayCall } from "../ui/tool-display.js";

export type AcpToolDisplayExecution = {
  readonly tool: { readonly name: string };
  readonly input?: Record<string, unknown>;
  readonly targetSummary?: string;
};

export type AcpRuntimeToolDisplayEvent = {
  readonly [key: string]: unknown;
  readonly tool?: unknown;
  readonly targetSummary?: unknown;
  readonly displayPreview?: unknown;
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

export function acpRuntimeToolEventTitle(event: AcpRuntimeToolDisplayEvent): string {
  const tool = typeof event.tool === "string" && event.tool.length > 0 ? event.tool : "tool";
  const displayPreview = typeof event.displayPreview === "string" && event.displayPreview.length > 0
    ? event.displayPreview
    : undefined;
  const targetSummary = typeof event.targetSummary === "string" && event.targetSummary.length > 0
    ? event.targetSummary
    : undefined;

  return formatToolDisplayCall({
    tool,
    preview: displayPreview ?? targetSummary,
  });
}
