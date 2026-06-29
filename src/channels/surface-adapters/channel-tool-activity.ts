// v0.95 Channel-Safe Tool Activity Renderer
// ASCII-only, no emoji, no ANSI. For CI/log-safe and email channels.

import type { RuntimeEvent } from "../../contracts/runtime-event.js";
import type { ToolDefinition } from "../../contracts/tool.js";
import { toolDisplayLabel } from "../../ui/tool-display.js";
import { formatCount, formatDuration, humanRisk } from "../../ui/tool-activity-format.js";

export type ChannelToolActivityRendererOptions = {
  tools: readonly ToolDefinition[];
  now?: () => number;
};

export class ChannelToolActivityRenderer {
  readonly #tools: Map<string, ToolDefinition>;
  readonly #starts = new Map<string, number[]>();
  readonly #now: () => number;

  constructor(options: ChannelToolActivityRendererOptions) {
    this.#tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.#now = options.now ?? (() => Date.now());
  }

  render(event: Extract<RuntimeEvent, { kind: "tool-start" | "tool-result" }>): string {
    if (event.kind === "tool-start") {
      this.#pushStart(this.#eventKey(event));
      const target = event.targetSummary ?? event.tool;
      return `[>] ${toolAction(event.tool, this.#tools.get(event.tool))} · preparing ${target}${event.stepId === undefined ? "" : ` · ${event.stepId}`}`;
    }

    const elapsed = this.#popElapsed(this.#eventKey(event));
    const target = event.targetSummary === undefined ? "" : ` · ${event.targetSummary}`;
    if (event.decision !== undefined && event.decision !== "allow") {
      return `! ${toolAction(event.tool, this.#tools.get(event.tool))}${target} gated · ${humanRisk(event.riskClass)}${elapsed}`;
    }

    const status = event.ok === false ? "failed" : "done";
    const icon = event.ok === false ? "[X]" : "[OK]";

    return `${icon} ${toolAction(event.tool, this.#tools.get(event.tool))}${target} ${status}${elapsed}${renderChannelToolSize(event)}`;
  }

  #pushStart(tool: string): void {
    const starts = this.#starts.get(tool) ?? [];
    starts.push(this.#now());
    this.#starts.set(tool, starts);
  }

  #popElapsed(tool: string): string {
    const starts = this.#starts.get(tool);
    const startedAt = starts?.shift();

    if (starts !== undefined && starts.length === 0) {
      this.#starts.delete(tool);
    }

    if (startedAt === undefined) {
      return "";
    }

    return ` · ${formatDuration(this.#now() - startedAt)}`;
  }

  #eventKey(event: Extract<RuntimeEvent, { kind: "tool-start" | "tool-result" }>): string {
    return event.activityId ?? `${event.tool}\0${event.targetSummary ?? ""}`;
  }
}

export function renderChannelToolSize(
  event: Extract<RuntimeEvent, { kind: "tool-result" }>
): string {
  if (event.chars === undefined || event.sentChars === undefined) {
    return "";
  }

  return ` · ${formatCount(event.chars)} captured / ${formatCount(event.sentChars)} sent${event.truncated ? " / compressed" : ""}`;
}

function toolAction(
  tool: string,
  definition: ToolDefinition | undefined
): string {
  if (definition?.progressLabel !== undefined) {
    return definition.progressLabel;
  }

  return toolDisplayLabel(tool);
}
