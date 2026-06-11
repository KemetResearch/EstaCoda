import type { DelegateRole } from "../contracts/delegation.js";
import type { RuntimeEvent, RuntimeEventSink } from "../contracts/runtime-event.js";

export type DelegationProgressMetadata = {
  subagentId: string;
  childSessionId: string;
  parentSessionId: string;
  role: DelegateRole;
  depth: number;
  taskIndex?: number;
  batchId?: string;
};

export type ProgressRelayOptions = {
  metadata: DelegationProgressMetadata;
  parentOnEvent?: RuntimeEventSink;
  throttleMs?: number;
  now?: () => number;
  onActivity?: (event: RuntimeEvent, summary: DelegationProgressSummary) => void;
};

export type DelegationProgressSummary = {
  kind: Extract<RuntimeEvent, { kind: "delegation-progress" }>["childEvent"]["kind"];
  summary: string;
  inToolExecution: boolean;
};

const DEFAULT_THROTTLE_MS = 1_000;
const RELAYED_EVENT_KINDS = new Set<RuntimeEvent["kind"]>([
  "agent-start",
  "tool-start",
  "tool-result",
  "provider-attempt",
  "provider-result",
  "provider-budget-exhausted",
  "agent-final",
  "agent-cancelled"
]);

export function createDelegationProgressRelay(options: ProgressRelayOptions): RuntimeEventSink {
  const throttleMs = Math.max(0, options.throttleMs ?? DEFAULT_THROTTLE_MS);
  const now = options.now ?? Date.now;
  const lastEmittedAt = new Map<string, number>();

  return async (event) => {
    const childEvent = toChildEvent(event);
    if (childEvent === undefined) {
      return;
    }
    const summary = summarizeChildEvent(childEvent);
    options.onActivity?.(event, summary);

    const key = throttleKey(childEvent);
    const emittedAt = lastEmittedAt.get(key);
    const currentTime = now();
    if (emittedAt !== undefined && currentTime - emittedAt < throttleMs) {
      return;
    }
    lastEmittedAt.set(key, currentTime);

    await options.parentOnEvent?.({
      kind: "delegation-progress",
      ...options.metadata,
      childEvent
    });
  };
}

function toChildEvent(event: RuntimeEvent): Extract<RuntimeEvent, { kind: "delegation-progress" }>["childEvent"] | undefined {
  if (!RELAYED_EVENT_KINDS.has(event.kind)) {
    return undefined;
  }

  switch (event.kind) {
    case "agent-start":
      return {
        kind: "agent-start",
        sessionId: event.sessionId
      };
    case "tool-start":
      return {
        kind: "tool-start",
        tool: event.tool
      };
    case "tool-result":
      return {
        kind: "tool-result",
        tool: event.tool,
        decision: event.decision,
        riskClass: event.riskClass,
        ok: event.ok,
        chars: event.chars,
        sentChars: event.sentChars,
        truncated: event.truncated
      };
    case "provider-attempt":
      return {
        kind: "provider-attempt",
        provider: event.provider,
        model: event.model,
        fallback: event.fallback
      };
    case "provider-result":
      return {
        kind: "provider-result",
        provider: event.provider,
        model: event.model,
        ok: event.ok,
        fallback: event.fallback,
        willFallback: event.willFallback,
        errorClass: event.errorClass,
        finishReason: event.finishReason,
        incompleteReason: event.incompleteReason
      };
    case "provider-budget-exhausted":
      return {
        kind: "provider-budget-exhausted",
        budget: event.budget,
        limit: event.limit,
        observed: event.observed,
        reason: event.reason
      };
    case "agent-final":
      return {
        kind: "agent-final",
        ok: true
      };
    case "agent-cancelled":
      return {
        kind: "agent-cancelled",
        reason: event.reason
      };
    default:
      return undefined;
  }
}

function summarizeChildEvent(event: Extract<RuntimeEvent, { kind: "delegation-progress" }>["childEvent"]): DelegationProgressSummary {
  switch (event.kind) {
    case "tool-start":
      return {
        kind: event.kind,
        summary: `tool-start:${event.tool ?? "unknown"}`,
        inToolExecution: true
      };
    case "tool-result":
      return {
        kind: event.kind,
        summary: `tool-result:${event.tool ?? "unknown"}:${event.ok === false ? "failed" : "ok"}`,
        inToolExecution: false
      };
    case "provider-attempt":
      return {
        kind: event.kind,
        summary: `provider-attempt:${event.provider ?? "unknown"}:${event.model ?? "unknown"}`,
        inToolExecution: false
      };
    case "provider-result":
      return {
        kind: event.kind,
        summary: `provider-result:${event.provider ?? "unknown"}:${event.ok ? "ok" : "failed"}`,
        inToolExecution: false
      };
    default:
      return {
        kind: event.kind,
        summary: event.kind,
        inToolExecution: false
      };
  }
}

function throttleKey(event: Extract<RuntimeEvent, { kind: "delegation-progress" }>["childEvent"]): string {
  return [
    event.kind,
    event.tool,
    event.provider,
    event.model,
    event.budget,
    event.reason
  ].filter((value) => value !== undefined).join(":");
}
