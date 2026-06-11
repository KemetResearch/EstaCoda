export type WhatsAppBridgeErrorCode =
  | "whatsapp_bridge_dependencies_missing"
  | "whatsapp_bridge_install_failed"
  | "whatsapp_bridge_install_timeout"
  | "whatsapp_bridge_lock_busy"
  | "whatsapp_bridge_pid_owner_mismatch"
  | "whatsapp_bridge_start_timeout"
  | "whatsapp_bridge_exited"
  | "whatsapp_bridge_state_missing"
  | "whatsapp_bridge_state_invalid"
  | "whatsapp_bridge_request_timeout"
  | "whatsapp_bridge_response_invalid"
  | "whatsapp_not_paired"
  | "whatsapp_missing_creds"
  | "whatsapp_logged_out"
  | "whatsapp_restart_required"
  | (string & {});

export type WhatsAppBridgeErrorDetails = Record<string, unknown>;

export type WhatsAppBridgeErrorShape = {
  code: WhatsAppBridgeErrorCode;
  message: string;
  details?: WhatsAppBridgeErrorDetails;
};

export type WhatsAppBridgeClassification = {
  code: WhatsAppBridgeErrorCode;
  retryable: boolean;
  retryDelayMs?: number;
};

export class WhatsAppBridgeRuntimeError extends Error {
  readonly code: WhatsAppBridgeErrorCode;
  readonly details?: WhatsAppBridgeErrorDetails;
  readonly retryable: boolean;
  readonly retryDelayMs?: number;

  constructor(error: WhatsAppBridgeErrorShape, classification?: Partial<WhatsAppBridgeClassification>) {
    super(error.message);
    this.name = "WhatsAppBridgeRuntimeError";
    this.code = error.code;
    this.details = error.details;
    const resolved = classifyWhatsAppBridgeErrorCode(error.code, classification);
    this.retryable = resolved.retryable;
    this.retryDelayMs = resolved.retryDelayMs;
  }
}

export function classifyWhatsAppBridgeErrorCode(
  code: WhatsAppBridgeErrorCode,
  override?: Partial<WhatsAppBridgeClassification>
): WhatsAppBridgeClassification {
  if (override?.retryable !== undefined) {
    return {
      code,
      retryable: override.retryable,
      retryDelayMs: override.retryDelayMs,
    };
  }

  if (
    code === "whatsapp_not_paired" ||
    code === "whatsapp_missing_creds" ||
    code === "whatsapp_logged_out" ||
    code === "whatsapp_bridge_dependencies_missing" ||
    code === "whatsapp_bridge_install_failed" ||
    code === "whatsapp_bridge_install_timeout" ||
    code === "whatsapp_bridge_lock_busy" ||
    code === "whatsapp_bridge_pid_owner_mismatch" ||
    code === "whatsapp_bridge_state_missing" ||
    code === "whatsapp_bridge_state_invalid"
  ) {
    return { code, retryable: false };
  }

  if (code === "whatsapp_restart_required") {
    return { code, retryable: true, retryDelayMs: 1000 };
  }

  return {
    code,
    retryable: true,
    retryDelayMs: override?.retryDelayMs,
  };
}

export function classifyWhatsAppBridgeError(error: unknown): WhatsAppBridgeClassification | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    code?: unknown;
    retryable?: unknown;
    retryDelayMs?: unknown;
  };
  if (typeof candidate.code !== "string") return undefined;
  return classifyWhatsAppBridgeErrorCode(candidate.code, {
    retryable: typeof candidate.retryable === "boolean" ? candidate.retryable : undefined,
    retryDelayMs: typeof candidate.retryDelayMs === "number" ? candidate.retryDelayMs : undefined,
  });
}
