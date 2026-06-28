import type { Writable } from "node:stream";
import {
  createOperatorConsoleRuntimeHost,
  type OperatorConsoleRuntimeHost,
  type OperatorConsoleStyle,
  type SetupPanelState,
  type SetupSurfaceState,
  type TerminalMetrics,
} from "../../ui/papyrus/operator-console/index.js";

export type SetupOperatorConsoleOutput = Pick<Writable, "write"> & {
  readonly columns?: number;
  readonly rows?: number;
  readonly isTTY?: boolean;
};

export type SetupOperatorConsoleControllerOptions = {
  readonly output: SetupOperatorConsoleOutput;
  readonly runtimeHost?: OperatorConsoleRuntimeHost;
  readonly terminal?: Partial<TerminalMetrics>;
  readonly style?: OperatorConsoleStyle;
};

export class SetupOperatorConsoleController {
  readonly #output: SetupOperatorConsoleOutput;
  readonly #runtimeHost: OperatorConsoleRuntimeHost;
  readonly #terminal: Partial<TerminalMetrics>;
  #renderedRows = 0;
  #currentPanel: SetupSurfaceState | undefined;

  constructor(options: SetupOperatorConsoleControllerOptions) {
    this.#output = options.output;
    this.#terminal = options.terminal ?? {};
    this.#runtimeHost = options.runtimeHost ?? createOperatorConsoleRuntimeHost({
      mode: "setup",
      terminal: setupTerminalSnapshot(options.output, options.terminal),
      style: options.style,
    });
    this.#runtimeHost.setMode("setup");
    this.#runtimeHost.setTerminal(setupTerminalSnapshot(this.#output, this.#terminal));
    if (options.style !== undefined) {
      this.#runtimeHost.setStyle(options.style);
    }
  }

  get runtimeHost(): OperatorConsoleRuntimeHost {
    return this.#runtimeHost;
  }

  get currentPanel(): SetupSurfaceState | undefined {
    return this.#currentPanel;
  }

  render(panel: SetupSurfaceState): number {
    this.#currentPanel = panel;
    this.#runtimeHost.clear();
    this.#runtimeHost.setMode("setup");
    this.#runtimeHost.setTerminal(setupTerminalSnapshot(this.#output, this.#terminal));
    this.#runtimeHost.setSetupPanel(panel);
    const frame = this.#runtimeHost.render();
    this.#renderLines(frame.lines);
    return frame.lines.length;
  }

  setSelectedRow(rowId: string): boolean {
    const panel = this.#currentPanel;
    if (panel?.kind !== "table") return false;
    if (!panel.rows.some((row) => row.id === rowId)) return false;
    const nextPanel: SetupPanelState = {
      ...panel,
      selectedRowId: rowId,
    };
    this.render(nextPanel);
    return true;
  }

  clear(): void {
    if (this.#renderedRows === 0) {
      this.#runtimeHost.setSetupPanel(undefined);
      this.#currentPanel = undefined;
      return;
    }

    this.#moveToFirstRenderedRow();
    for (let row = 0; row < this.#renderedRows; row += 1) {
      this.#output.write("\x1b[0K");
      if (row < this.#renderedRows - 1) this.#output.write("\n");
    }
    this.#moveToFrameStart();
    this.#renderedRows = 0;
    this.#runtimeHost.setSetupPanel(undefined);
    this.#currentPanel = undefined;
  }

  #renderLines(lines: readonly string[]): void {
    this.#moveToFirstRenderedRow();

    const physicalRows = Math.max(this.#renderedRows, lines.length);
    for (let row = 0; row < physicalRows; row += 1) {
      this.#output.write("\x1b[0K");
      if (row < lines.length) this.#output.write(lines[row]!);
      if (row < physicalRows - 1) this.#output.write("\n");
    }

    this.#moveToFrameStart();
    this.#renderedRows = lines.length;
  }

  #moveToFirstRenderedRow(): void {
    if (this.#renderedRows > 1) this.#output.write(`\x1b[${this.#renderedRows - 1}A`);
    if (this.#renderedRows > 0) this.#output.write("\r");
  }

  #moveToFrameStart(): void {
    this.#output.write("\r");
  }
}

export function createSetupOperatorConsoleController(
  options: SetupOperatorConsoleControllerOptions
): SetupOperatorConsoleController {
  return new SetupOperatorConsoleController(options);
}

function setupTerminalSnapshot(
  output: SetupOperatorConsoleOutput,
  terminal: Partial<TerminalMetrics> | undefined
): TerminalMetrics {
  return {
    width: normalizePositiveInteger(terminal?.width ?? output.columns, 80),
    height: normalizePositiveInteger(terminal?.height ?? output.rows, 24),
    isTty: terminal?.isTty ?? output.isTTY ?? true,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}
