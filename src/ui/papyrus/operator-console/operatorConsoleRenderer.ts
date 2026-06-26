import type {
  OperatorConsoleLayout,
  OperatorConsoleRegion,
} from "./operatorConsoleLayout.js";
import type {
  OperatorConsoleState,
  StatusRailState,
} from "./operatorConsoleState.js";

export type OperatorConsoleRenderedLine = {
  readonly region: OperatorConsoleRegion["kind"];
  readonly text: string;
};

export function renderOperatorConsoleLines(
  state: OperatorConsoleState,
  layout: OperatorConsoleLayout
): readonly OperatorConsoleRenderedLine[] {
  return layout.regions.flatMap((region) => renderRegionLines(state, region));
}

export function renderOperatorConsoleTextLines(
  state: OperatorConsoleState,
  layout: OperatorConsoleLayout
): readonly string[] {
  return renderOperatorConsoleLines(state, layout).map((line) => line.text);
}

function renderRegionLines(
  state: OperatorConsoleState,
  region: OperatorConsoleRegion
): readonly OperatorConsoleRenderedLine[] {
  if (!region.visible || region.height <= 0 || region.width <= 0) return [];
  const lines: OperatorConsoleRenderedLine[] = [];
  for (let row = 0; row < region.height; row += 1) {
    lines.push({
      region: region.kind,
      text: truncateLine(regionLabel(state, region, row), region.width),
    });
  }
  return lines;
}

function regionLabel(
  state: OperatorConsoleState,
  region: OperatorConsoleRegion,
  row: number
): string {
  if (row > 0) return `${region.kind}`;
  switch (region.kind) {
    case "transcript":
      return `Transcript: ${state.transcript.length} block${plural(state.transcript.length)}`;
    case "activeWork":
      return `Active work: ${state.activeWork.events.length} event${plural(state.activeWork.events.length)}`;
    case "queuedSteer":
      return `Queued steer: ${state.steer?.queued?.text ?? ""}`;
    case "attachments":
      return `Attachments: ${state.attachments.length}`;
    case "prompt":
      return `Prompt: ${state.prompt.value.length > 0 ? state.prompt.value : ">"}`;
    case "slashMenu":
      return `Slash menu: ${state.slash?.query ?? ""}`;
    case "statusRail":
      return formatStatusRail(state.status);
  }
}

function formatStatusRail(status: StatusRailState): string {
  const model = status.model.label.length > 0 ? status.model.label : "model pending";
  const context = status.context.totalTokens === undefined
    ? `${status.context.usedTokens}`
    : `${status.context.usedTokens}/${status.context.totalTokens}`;
  const percent = status.context.percent === undefined ? "" : ` ${status.context.percent}%`;
  return `${model} | ctx ${context}${percent} | session ${formatElapsed(status.sessionTimer.elapsedMs)}`;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function truncateLine(line: string, width: number): string {
  if (width <= 0) return "";
  if (line.length <= width) return line;
  return line.slice(0, width);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
