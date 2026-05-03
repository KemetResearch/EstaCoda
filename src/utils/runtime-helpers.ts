import type { RuntimeEvent, RuntimeEventSink } from "../contracts/runtime-event.js";

export async function emit(sink: RuntimeEventSink | undefined, event: RuntimeEvent): Promise<void> {
  await sink?.(event);
}

export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}
