import {
  createInitialKeypressParseState,
  keypressParseFlushDelayMs,
  keypressParseStateNeedsFlush,
  parseKeypressStream,
  type KeypressParseState,
  type ParsedKeypress,
} from "./parseKeypress.js";

export type KeypressStreamDispatcher = {
  handle(chunk: string | Buffer | Uint8Array): void;
  flush(): void;
  dispose(): void;
};

export function createKeypressStreamDispatcher(options: {
  readonly onEvents: (events: readonly ParsedKeypress[]) => void;
}): KeypressStreamDispatcher {
  let state: KeypressParseState = createInitialKeypressParseState();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearFlushTimer = () => {
    if (flushTimer === undefined) return;
    clearTimeout(flushTimer);
    flushTimer = undefined;
  };

  const dispatchParsedEvents = (events: readonly ParsedKeypress[]) => {
    if (disposed || events.length === 0) return;
    options.onEvents(events);
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    if (disposed || !keypressParseStateNeedsFlush(state)) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      if (disposed) return;
      const parsed = parseKeypressStream(state, null);
      state = parsed.state;
      dispatchParsedEvents(parsed.events);
      scheduleFlush();
    }, keypressParseFlushDelayMs(state));
  };

  return {
    handle(chunk) {
      if (disposed) return;
      clearFlushTimer();
      const parsed = parseKeypressStream(state, typeof chunk === "string" ? chunk : Buffer.from(chunk));
      state = parsed.state;
      dispatchParsedEvents(parsed.events);
      scheduleFlush();
    },
    flush() {
      if (disposed) return;
      clearFlushTimer();
      const parsed = parseKeypressStream(state, null);
      state = parsed.state;
      dispatchParsedEvents(parsed.events);
      scheduleFlush();
    },
    dispose() {
      disposed = true;
      clearFlushTimer();
    },
  };
}
