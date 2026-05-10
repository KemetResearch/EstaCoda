// v0.95 Prompt Chrome Controller — Pass 7B persistent rails.
// Bounded prompt chrome using ANSI cursor control.
// Disabled for non-TTY, CI, dumb, plain, or no-color terminals.

import type { TerminalCapabilities } from "../contracts/ui.js";
import type {
  ActiveTurnSpinnerViewModel,
  SessionStatusRailViewModel,
  ShortcutHintRailViewModel,
  ViewModel,
} from "../contracts/view-model.js";
import { truncateVisible } from "../ui/renderers/layout.js";

export interface PromptChromeState {
  readonly statusRail?: SessionStatusRailViewModel;
  readonly shortcutRail?: ShortcutHintRailViewModel;
  readonly activeSpinner?: ActiveTurnSpinnerViewModel;
}

export interface PromptChromeControllerOptions {
  readonly output: NodeJS.WritableStream;
  readonly capabilities: TerminalCapabilities;
  readonly renderViewModel: (vm: ViewModel) => string;
  readonly enabled?: boolean;
}

/**
 * Controller for drawing a bounded status row above the prompt line
 * and clearing it before transcript output so it never enters scrollback.
 *
 * This is a feasibility prototype (Pass 7A). It assumes the prompt
 * fits on one line; wrapped prompts may leave the status line uncleared.
 */
export class PromptChromeController {
  readonly #output: NodeJS.WritableStream;
  readonly #capabilities: TerminalCapabilities;
  readonly #renderViewModel: (vm: ViewModel) => string;
  readonly #enabled: boolean;
  #active: boolean;
  #activeLineCount: number;

  constructor(options: PromptChromeControllerOptions) {
    this.#output = options.output;
    this.#capabilities = options.capabilities;
    this.#renderViewModel = options.renderViewModel;
    this.#enabled = options.enabled ?? detectEnabled(options.capabilities);
    this.#active = false;
    this.#activeLineCount = 0;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Draw bounded chrome rails above the upcoming prompt. */
  renderChrome(state: PromptChromeState): void {
    if (!this.#enabled) return;
    const lines = this.#renderChromeLines(state);
    if (lines.length === 0) return;
    this.clearChrome();
    this.#output.write(`${lines.join("\n")}\n`);
    this.#active = true;
    this.#activeLineCount = lines.length;
  }

  /** Clear previously drawn rail lines using cursor-control sequences. */
  clearChrome(): void {
    if (!this.#enabled || !this.#active) return;
    // From the line below the submitted prompt, move up across the prompt line
    // plus all rail lines, clear only rail lines, then return to the original
    // cursor position. The prompt line belongs to readline until a future input
    // rewrite owns it fully.
    const railLines = Math.max(1, this.#activeLineCount);
    let sequence = `\x1b[${railLines + 1}A`;
    for (let index = 0; index < railLines; index += 1) {
      sequence += "\x1b[2K";
      if (index < railLines - 1) {
        sequence += "\x1b[1B";
      }
    }
    sequence += "\x1b[2B";
    this.#output.write(sequence);
    this.#active = false;
    this.#activeLineCount = 0;
  }

  /** Clear chrome, run the given function, and leave chrome cleared. */
  async suspendChromeForTranscript<T>(fn: () => T | Promise<T>): Promise<T> {
    if (!this.#enabled || !this.#active) {
      return await fn();
    }
    this.clearChrome();
    return await fn();
  }

  /** Invalidate the currently drawn chrome region. */
  invalidate(): void {
    this.clearChrome();
  }

  /** Final cleanup — clear any active chrome. */
  dispose(): void {
    this.clearChrome();
  }

  #renderChromeLines(state: PromptChromeState): string[] {
    const width = Math.max(1, this.#capabilities.terminalWidth);
    const rendered: string[] = [];

    if (state.statusRail !== undefined) {
      rendered.push(...this.#boundedLines(this.#renderViewModel(state.statusRail), width));
    }

    if (state.shortcutRail !== undefined) {
      rendered.push(...this.#boundedLines(this.#renderViewModel(state.shortcutRail), width));
    }

    // Pass 7B only carries the placeholder structurally. Rendering active
    // spinner behavior starts in Pass 9; do not render it here.
    void state.activeSpinner;

    return rendered;
  }

  #boundedLines(value: string, width: number): string[] {
    return value
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => truncateVisible(line.replace(/[\r\n]+/gu, " "), width));
  }
}

function detectEnabled(caps: TerminalCapabilities): boolean {
  return caps.isTTY && !caps.isCI && !caps.isDumb && caps.supportsColor;
}
