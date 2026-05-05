import type { TerminalCapabilities } from "../../contracts/ui.js";

export interface AnimationControllerOptions {
  readonly frames: readonly string[];
  readonly intervalMs: number;
  readonly capabilities: TerminalCapabilities;
  readonly onFrame?: (frame: string) => void;
}

// AnimationController provides capability-gated frame cycling.
// When animation is forbidden (plain, CI, non-TTY, TERM=dumb), it returns
// a static frame and never starts a timer. This prevents provider-token
// stream corruption and avoids spinning in unsuitable environments.
export class AnimationController {
  readonly #frames: readonly string[];
  readonly #intervalMs: number;
  readonly #capabilities: TerminalCapabilities;
  readonly #onFrame?: (frame: string) => void;
  #index = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(options: AnimationControllerOptions) {
    this.#frames = options.frames;
    this.#intervalMs = options.intervalMs;
    this.#capabilities = options.capabilities;
    this.#onFrame = options.onFrame;
  }

  get canAnimate(): boolean {
    return this.#capabilities.supportsAnimation;
  }

  get currentFrame(): string {
    if (!this.canAnimate || this.#frames.length === 0) {
      return this.#frames[0] ?? "";
    }
    return this.#frames[this.#index % this.#frames.length] ?? "";
  }

  start(): void {
    if (!this.canAnimate || this.#running || this.#frames.length === 0) {
      return;
    }
    this.#running = true;
    this.#timer = setInterval(() => {
      this.#index = (this.#index + 1) % this.#frames.length;
      this.#onFrame?.(this.currentFrame);
    }, this.#intervalMs);
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#running = false;
  }

  dispose(): void {
    this.stop();
  }

  get isRunning(): boolean {
    return this.#running;
  }
}

export interface SpinnerOptions {
  readonly frames: readonly string[];
  readonly intervalMs?: number;
  readonly capabilities: TerminalCapabilities;
}

export function createSpinner(options: SpinnerOptions): AnimationController {
  return new AnimationController({
    frames: options.frames,
    intervalMs: options.intervalMs ?? 80,
    capabilities: options.capabilities,
  });
}

export function createWaitingSpinner(
  frames: readonly string[],
  capabilities: TerminalCapabilities
): AnimationController {
  return createSpinner({ frames, capabilities });
}

export function createThinkingSpinner(
  frames: readonly string[],
  capabilities: TerminalCapabilities
): AnimationController {
  return createSpinner({ frames, intervalMs: 120, capabilities });
}
