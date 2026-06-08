export type FailureClass =
  | "provider-error"          // LLM provider failure (rate limit, timeout, auth)
  | "provider-refusal"        // Provider refused the request
  | "tool-execution-error"    // Tool threw an exception
  | "tool-not-found"          // Tool name invalid or unavailable
  | "tool-blocked"            // Security policy blocked the tool
  | "tool-invalid-args"       // Tool arguments failed schema validation
  | "tool-timeout"            // Tool execution exceeded time limit
  | "plan-dependency-error"   // Tool plan dependency resolution failed
  | "skill-playbook-step-error"     // Skill playbook step failed
  | "budget-exhausted"        // Token or cost budget exceeded
  | "security-escalation"     // Risk escalation aborted the run
  | "user-cancelled"          // User cancelled the run
  | "agent-loop-exhausted"    // Max iterations reached
  | "unknown";                // Unclassified

export type FailureRecord = {
  id: string;
  sessionId: string;
  trajectoryId?: string;
  timestamp: string;
  class: FailureClass;
  sourceEventKind: string;     // e.g., "tool-result", "provider-completion"
  sourceEventId?: string;
  tool?: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
};
