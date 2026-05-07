import type { ChannelAdapter, ChannelKind, ChannelDelivery, ChannelMessage } from "../contracts/channel.js";
import type { AdapterRuntimeState } from "./adapter-runtime-state.js";

export const DEFAULT_ADAPTER_BACKOFF = {
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  maxAttempts: 5,
  jitter: 0.2,
};

export type BackoffOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitter?: number;
  randomFn?: () => number;
};

export function computeBackoffDelay(attempt: number, options: Required<BackoffOptions>): number {
  const base = Math.min(
    options.baseDelayMs * Math.pow(2, attempt - 1),
    options.maxDelayMs
  );
  const jitterFactor = 1 + options.randomFn() * options.jitter;
  return Math.round(base * jitterFactor);
}

export class AdapterResilienceSupervisor {
  readonly rawAdapter: ChannelAdapter;
  readonly #options: Required<BackoffOptions>;
  #state: AdapterRuntimeState;
  #handler: ((message: ChannelMessage) => Promise<void>) | undefined;
  #onStateChange: (() => void) | undefined;

  constructor(
    adapter: ChannelAdapter,
    options?: BackoffOptions,
    onStateChange?: () => void
  ) {
    this.rawAdapter = adapter;
    this.#options = {
      baseDelayMs: options?.baseDelayMs ?? DEFAULT_ADAPTER_BACKOFF.baseDelayMs,
      maxDelayMs: options?.maxDelayMs ?? DEFAULT_ADAPTER_BACKOFF.maxDelayMs,
      maxAttempts: options?.maxAttempts ?? DEFAULT_ADAPTER_BACKOFF.maxAttempts,
      jitter: options?.jitter ?? DEFAULT_ADAPTER_BACKOFF.jitter,
      randomFn: options?.randomFn ?? Math.random,
    };
    this.#onStateChange = onStateChange;
    this.#state = {
      kind: adapter.kind,
      state: "starting",
      pollsTotal: 0,
      pollsFailed: 0,
      pollMessagesProcessed: 0,
    };
  }

  get id(): string | undefined {
    return this.rawAdapter.id;
  }

  get kind(): ChannelKind {
    return this.rawAdapter.kind;
  }

  get delivery(): ChannelDelivery | undefined {
    return this.rawAdapter.delivery;
  }

  get pair(): ChannelAdapter["pair"] {
    return this.rawAdapter.pair;
  }

  get receive(): ChannelAdapter["receive"] {
    return this.rawAdapter.receive;
  }

  get send(): ChannelAdapter["send"] {
    return this.rawAdapter.send;
  }

  get getCapabilities(): ChannelAdapter["getCapabilities"] {
    return this.rawAdapter.getCapabilities;
  }

  get pollOnce(): ChannelAdapter["pollOnce"] {
    return this.rawAdapter.pollOnce === undefined
      ? undefined
      : this.poll.bind(this);
  }

  getState(): AdapterRuntimeState {
    return { ...this.#state };
  }

  async start(handler: (message: ChannelMessage) => Promise<void>): Promise<void> {
    this.#handler = handler;
    this.#state.state = "starting";
    this.#state.startedAt = new Date().toISOString();
    this.#emitChange();

    try {
      await this.rawAdapter.start?.(handler);
      this.#state.state = "healthy";
      this.#state.pendingOperation = undefined;
      this.#state.lastError = undefined;
      this.#state.retry = undefined;
      this.#emitChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#handleFailure("start", message);
    }
  }

  async stop(): Promise<void> {
    this.#state.state = "stopped";
    this.#state.stoppedAt = new Date().toISOString();
    this.#state.pendingOperation = undefined;
    this.#state.retry = undefined;
    this.#emitChange();

    try {
      await this.rawAdapter.stop?.();
    } catch {
      /* ignore stop errors */
    }
  }

  async tick(): Promise<void> {
    if (this.#state.state === "stopped" || this.#state.state === "failed") {
      return;
    }

    if (this.#state.state === "degraded" && this.#state.pendingOperation === "start") {
      await this.#retryOperation("start");
      return;
    }

    if (this.#state.state === "retry_scheduled" && this.#state.pendingOperation !== undefined) {
      const now = Date.now();
      const nextRetryAt = this.#state.retry !== undefined
        ? new Date(this.#state.retry.nextRetryAt).getTime()
        : 0;
      if (!Number.isNaN(nextRetryAt) && now >= nextRetryAt) {
        await this.#retryOperation(this.#state.pendingOperation);
      }
      return;
    }
  }

  async poll(): Promise<number> {
    if (this.rawAdapter.pollOnce === undefined) {
      return 0;
    }

    if (
      this.#state.state !== "healthy" &&
      !(this.#state.state === "degraded" && this.#state.pendingOperation === "poll")
    ) {
      return 0;
    }

    try {
      const count = await this.rawAdapter.pollOnce();
      this.#state.pollsTotal += 1;
      this.#state.pollMessagesProcessed += typeof count === "number" ? count : 0;
      if (this.#state.state !== "healthy") {
        this.#state.state = "healthy";
        this.#state.pendingOperation = undefined;
        this.#state.lastError = undefined;
        this.#state.retry = undefined;
      }
      this.#emitChange();
      return typeof count === "number" ? count : 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#state.pollsFailed += 1;
      this.#handleFailure("poll", message);
      return 0;
    }
  }

  #handleFailure(operation: "start" | "poll", message: string): void {
    const now = new Date().toISOString();
    const isRetry = this.#state.lastError !== undefined && this.#state.pendingOperation === operation;
    const consecutiveCount = isRetry
      ? this.#state.lastError!.count + 1
      : 1;

    this.#state.lastError = {
      message,
      timestamp: now,
      count: consecutiveCount,
    };
    this.#state.pendingOperation = operation;

    if (!isRetry) {
      // First failure for this operation
      this.#state.state = "degraded";
      this.#state.retry = undefined;
    } else {
      // Subsequent failure - apply backoff
      const attempt = this.#state.retry !== undefined
        ? this.#state.retry.attempt + 1
        : 2;
      if (attempt > this.#options.maxAttempts) {
        this.#state.state = "failed";
        this.#state.retry = undefined;
      } else {
        const delay = computeBackoffDelay(attempt - 1, this.#options);
        const nextRetryAt = new Date(Date.now() + delay).toISOString();
        this.#state.state = "retry_scheduled";
        this.#state.retry = {
          attempt,
          maxAttempts: this.#options.maxAttempts,
          nextRetryAt,
        };
      }
    }

    this.#emitChange();
  }

  async #retryOperation(operation: "start" | "poll"): Promise<void> {
    if (operation === "start") {
      this.#state.state = "starting";
      this.#emitChange();
      try {
        await this.rawAdapter.start?.(this.#handler!);
        this.#state.state = "healthy";
        this.#state.pendingOperation = undefined;
        this.#state.lastError = undefined;
        this.#state.retry = undefined;
        this.#emitChange();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#handleFailure("start", message);
      }
    } else {
      try {
        const count = await this.rawAdapter.pollOnce?.();
        this.#state.pollsTotal += 1;
        this.#state.pollMessagesProcessed += typeof count === "number" ? count : 0;
        this.#state.state = "healthy";
        this.#state.pendingOperation = undefined;
        this.#state.lastError = undefined;
        this.#state.retry = undefined;
        this.#emitChange();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#state.pollsFailed += 1;
        this.#handleFailure("poll", message);
      }
    }
  }

  #emitChange(): void {
    this.#onStateChange?.();
  }
}
