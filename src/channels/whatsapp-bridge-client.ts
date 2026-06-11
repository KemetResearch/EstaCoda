import { readFile } from "node:fs/promises";
import {
  WhatsAppBridgeRuntimeError,
  type WhatsAppBridgeErrorCode,
  type WhatsAppBridgeErrorShape,
} from "./whatsapp-bridge-errors.js";

export const EXPECTED_WHATSAPP_BRIDGE_API_VERSION = "whatsapp-bridge.v1";
const MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_INBOUND_ATTACHMENTS = 8;
const MAX_ATTACHMENT_METADATA_KEYS = 16;
const MAX_ATTACHMENT_METADATA_STRING = 4096;
export type WhatsAppBridgeInboundAttachmentKind = "image" | "video" | "audio" | "voice" | "document";

export type WhatsAppBridgeHealth = {
  ok: boolean;
  apiVersion: string;
  status?: "connected" | "disconnected" | "connecting" | "logged_out" | "error";
  queueLength?: number;
  droppedMessages?: number;
  uptimeSeconds?: number;
  version?: string;
  error?: WhatsAppBridgeError;
};

export type WhatsAppBridgeError = WhatsAppBridgeErrorShape;

export type WhatsAppBridgeInboundAttachment = {
  id?: string;
  kind: WhatsAppBridgeInboundAttachmentKind;
  status?: "ready" | "failed" | "unsupported" | "too-large" | "download-failed" | "missing-file";
  mimeType?: string;
  originalName?: string;
  localPath?: string;
  bytes?: number;
  failureCode?: string;
  failureMessage?: string;
  metadata?: Record<string, unknown>;
};

export type WhatsAppBridgeInboundMessage = {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  chatName?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  mediaType?: string;
  attachments?: WhatsAppBridgeInboundAttachment[];
  mentionedIds?: string[];
  quotedMessageId?: string | null;
  quotedParticipant?: string | null;
  quotedRemoteJid?: string | null;
  hasQuotedMessage?: boolean;
  botIds?: string[];
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type WhatsAppBridgeSendTextInput = {
  chatId: string;
  message: string;
  replyTo?: string | null;
};

export type WhatsAppBridgeSendMediaInput = {
  chatId: string;
  filePath: string;
  mediaType?: "image" | "video" | "audio" | "voice" | "document";
  caption?: string;
  fileName?: string;
};

export type WhatsAppBridgeEditInput = {
  chatId: string;
  messageId: string;
  message: string;
};

export type WhatsAppBridgeTypingInput = {
  chatId: string;
  state: "composing" | "paused";
};

export type WhatsAppBridgeChatInfo = {
  id: string;
  name?: string;
  isGroup?: boolean;
  participants?: string[];
};

export type WhatsAppBridgeSendResult = {
  ok: boolean;
  messageId?: string;
  messageIds?: string[];
  error?: WhatsAppBridgeError;
};

export type WhatsAppBridgeClient = {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  getHealth(): Promise<WhatsAppBridgeHealth>;
  pollMessages(): Promise<WhatsAppBridgeInboundMessage[]>;
  sendText(input: WhatsAppBridgeSendTextInput): Promise<WhatsAppBridgeSendResult>;
  editMessage(input: WhatsAppBridgeEditInput): Promise<WhatsAppBridgeSendResult>;
  sendMedia(input: WhatsAppBridgeSendMediaInput): Promise<WhatsAppBridgeSendResult>;
  sendTyping(input: WhatsAppBridgeTypingInput): Promise<WhatsAppBridgeSendResult>;
  getChat(chatId: string): Promise<WhatsAppBridgeChatInfo>;
};

export type WhatsAppBridgeState = {
  baseUrl: string;
  token: string;
};

export type HttpWhatsAppBridgeClientOptions = {
  statePath?: string;
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
};

export class WhatsAppBridgeClientError extends WhatsAppBridgeRuntimeError {
  constructor(error: WhatsAppBridgeError) {
    super(error);
    this.name = "WhatsAppBridgeClientError";
  }
}

export class HttpWhatsAppBridgeClient implements WhatsAppBridgeClient {
  readonly #statePath: string | undefined;
  readonly #baseUrl: string | undefined;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(options: HttpWhatsAppBridgeClientOptions = {}) {
    this.#statePath = options.statePath;
    this.#baseUrl = options.baseUrl;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async getHealth(): Promise<WhatsAppBridgeHealth> {
    return validateHealth(await this.#request("GET", "/health"));
  }

  async pollMessages(): Promise<WhatsAppBridgeInboundMessage[]> {
    return validateMessages(await this.#request("GET", "/messages"));
  }

  async sendText(input: WhatsAppBridgeSendTextInput): Promise<WhatsAppBridgeSendResult> {
    return validateSendResult(await this.#request("POST", "/send", input));
  }

  async editMessage(input: WhatsAppBridgeEditInput): Promise<WhatsAppBridgeSendResult> {
    return validateSendResult(await this.#request("POST", "/edit", input));
  }

  async sendMedia(input: WhatsAppBridgeSendMediaInput): Promise<WhatsAppBridgeSendResult> {
    return validateSendResult(await this.#request("POST", "/send-media", input));
  }

  async sendTyping(input: WhatsAppBridgeTypingInput): Promise<WhatsAppBridgeSendResult> {
    return validateSendResult(await this.#request("POST", "/typing", input));
  }

  async getChat(chatId: string): Promise<WhatsAppBridgeChatInfo> {
    if (chatId.length === 0) {
      throw new WhatsAppBridgeClientError({
        code: "whatsapp_bridge_response_invalid",
        message: "WhatsApp chat id is required.",
      });
    }
    return validateChat(await this.#request("GET", `/chat/${encodeURIComponent(chatId)}`));
  }

  async #request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const state = await this.#resolveState();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, state.baseUrl), {
        method,
        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${state.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new WhatsAppBridgeClientError({
          code: "whatsapp_bridge_request_timeout",
          message: "WhatsApp bridge request timed out.",
          details: { path },
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const parsed = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      throw new WhatsAppBridgeClientError(normalizeBridgeError(parsed, response.status));
    }
    if (isBridgeErrorEnvelope(parsed)) {
      throw new WhatsAppBridgeClientError(parsed.error);
    }
    return parsed;
  }

  async #resolveState(): Promise<WhatsAppBridgeState> {
    if (this.#baseUrl !== undefined && this.#token !== undefined) {
      return { baseUrl: this.#baseUrl, token: this.#token };
    }
    if (this.#statePath === undefined) {
      throw new WhatsAppBridgeClientError({
        code: "whatsapp_bridge_state_missing",
        message: "WhatsApp bridge state is not configured.",
      });
    }
    const parsed = JSON.parse(await readFile(this.#statePath, "utf8")) as Partial<WhatsAppBridgeState>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") {
      throw new WhatsAppBridgeClientError({
        code: "whatsapp_bridge_state_invalid",
        message: "WhatsApp bridge state is invalid.",
      });
    }
    return { baseUrl: parsed.baseUrl, token: parsed.token };
  }
}

function isBridgeErrorEnvelope(value: unknown): value is { ok: false; error: WhatsAppBridgeError } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { ok?: unknown; error?: unknown };
  return candidate.ok === false && typeof candidate.error === "object" && candidate.error !== null;
}

function normalizeBridgeError(value: unknown, status: number): WhatsAppBridgeError {
  if (isBridgeErrorEnvelope(value)) return value.error;
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      const details = (error as { details?: unknown }).details;
      return {
        code: String((error as { code: unknown }).code) as WhatsAppBridgeErrorCode,
        message: String((error as { message: unknown }).message),
        details: isRecord(details) ? details : undefined,
      };
    }
    if (typeof error === "string") {
      return { code: `http_${status}`, message: error };
    }
  }
  return { code: `http_${status}`, message: `WhatsApp bridge request failed with HTTP ${status}.` };
}

function validateHealth(value: unknown): WhatsAppBridgeHealth {
  if (!isRecord(value) || typeof value.ok !== "boolean" || value.apiVersion !== EXPECTED_WHATSAPP_BRIDGE_API_VERSION) {
    throwInvalidResponse("Invalid WhatsApp bridge health response.");
  }
  return {
    ok: value.ok,
    apiVersion: value.apiVersion,
    status: typeof value.status === "string" ? value.status as WhatsAppBridgeHealth["status"] : undefined,
    queueLength: typeof value.queueLength === "number" ? value.queueLength : undefined,
    droppedMessages: typeof value.droppedMessages === "number" ? value.droppedMessages : undefined,
    uptimeSeconds: typeof value.uptimeSeconds === "number" ? value.uptimeSeconds : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
    error: isErrorShape(value.error) ? value.error : undefined,
  };
}

function validateMessages(value: unknown): WhatsAppBridgeInboundMessage[] {
  if (!Array.isArray(value)) throwInvalidResponse("Invalid WhatsApp bridge messages response.");
  return value.map((message) => {
    if (!isRecord(message) ||
      typeof message.messageId !== "string" ||
      typeof message.chatId !== "string" ||
      typeof message.senderId !== "string") {
      throwInvalidResponse("Invalid WhatsApp bridge message response.");
    }
    return {
      messageId: message.messageId,
      chatId: message.chatId,
      senderId: message.senderId,
      senderName: typeof message.senderName === "string" ? message.senderName : undefined,
      chatName: typeof message.chatName === "string" ? message.chatName : undefined,
      isGroup: typeof message.isGroup === "boolean" ? message.isGroup : undefined,
      fromMe: typeof message.fromMe === "boolean" ? message.fromMe : undefined,
      body: typeof message.body === "string" ? message.body : undefined,
      hasMedia: typeof message.hasMedia === "boolean" ? message.hasMedia : undefined,
      mediaType: typeof message.mediaType === "string" ? message.mediaType : undefined,
      attachments: validateInboundAttachments(message.attachments),
      mentionedIds: Array.isArray(message.mentionedIds) && message.mentionedIds.every((id) => typeof id === "string")
        ? message.mentionedIds
        : undefined,
      quotedMessageId: typeof message.quotedMessageId === "string" || message.quotedMessageId === null ? message.quotedMessageId : undefined,
      quotedParticipant: typeof message.quotedParticipant === "string" || message.quotedParticipant === null ? message.quotedParticipant : undefined,
      quotedRemoteJid: typeof message.quotedRemoteJid === "string" || message.quotedRemoteJid === null ? message.quotedRemoteJid : undefined,
      hasQuotedMessage: typeof message.hasQuotedMessage === "boolean" ? message.hasQuotedMessage : undefined,
      botIds: Array.isArray(message.botIds) && message.botIds.every((id) => typeof id === "string") ? message.botIds : undefined,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
      metadata: sanitizeMetadata(message.metadata),
    } satisfies WhatsAppBridgeInboundMessage;
  });
}

function validateInboundAttachments(value: unknown): WhatsAppBridgeInboundAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .slice(0, MAX_INBOUND_ATTACHMENTS)
    .map(validateInboundAttachment)
    .filter((attachment): attachment is WhatsAppBridgeInboundAttachment => attachment !== undefined);
  return attachments.length > 0 ? attachments : undefined;
}

function validateInboundAttachment(value: unknown): WhatsAppBridgeInboundAttachment | undefined {
  if (!isRecord(value) || !isKnownAttachmentKind(value.kind)) return undefined;
  const status = isKnownAttachmentStatus(value.status) ? value.status : undefined;
  if (status === undefined) return undefined;
  const bytes = typeof value.bytes === "number" && Number.isFinite(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_INBOUND_ATTACHMENT_BYTES
    ? value.bytes
    : undefined;
  if (status === "ready") {
    if (typeof value.localPath !== "string" || value.localPath.length === 0) return undefined;
    if (bytes === undefined) return undefined;
  }
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    kind: value.kind,
    status,
    mimeType: typeof value.mimeType === "string" ? value.mimeType.slice(0, 160) : undefined,
    originalName: typeof value.originalName === "string" ? value.originalName.slice(0, 160) : undefined,
    localPath: status === "ready" && typeof value.localPath === "string" ? value.localPath : undefined,
    bytes,
    failureCode: typeof value.failureCode === "string" ? value.failureCode.slice(0, 80) : undefined,
    failureMessage: typeof value.failureMessage === "string" ? value.failureMessage.slice(0, 240) : undefined,
    metadata: sanitizeMetadata(value.metadata),
  };
}

function isKnownAttachmentKind(value: unknown): value is WhatsAppBridgeInboundAttachmentKind {
  return value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "voice" ||
    value === "document";
}

function isKnownAttachmentStatus(value: unknown): value is NonNullable<WhatsAppBridgeInboundAttachment["status"]> {
  return value === "ready" ||
    value === "failed" ||
    value === "unsupported" ||
    value === "too-large" ||
    value === "download-failed" ||
    value === "missing-file";
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).slice(0, MAX_ATTACHMENT_METADATA_KEYS);
  const clean: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(key)) continue;
    if (typeof raw === "string") clean[key] = raw.slice(0, MAX_ATTACHMENT_METADATA_STRING);
    else if (typeof raw === "number" && Number.isFinite(raw)) clean[key] = raw;
    else if (typeof raw === "boolean") clean[key] = raw;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function validateSendResult(value: unknown): WhatsAppBridgeSendResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throwInvalidResponse("Invalid WhatsApp bridge send response.");
  }
  return {
    ok: value.ok,
    messageId: typeof value.messageId === "string" ? value.messageId : undefined,
    messageIds: Array.isArray(value.messageIds) && value.messageIds.every((id) => typeof id === "string")
      ? value.messageIds
      : undefined,
    error: isErrorShape(value.error) ? value.error : undefined,
  };
}

function validateChat(value: unknown): WhatsAppBridgeChatInfo {
  if (!isRecord(value) || typeof value.id !== "string") {
    throwInvalidResponse("Invalid WhatsApp bridge chat response.");
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    isGroup: typeof value.isGroup === "boolean" ? value.isGroup : undefined,
    participants: Array.isArray(value.participants) && value.participants.every((id) => typeof id === "string")
      ? value.participants
      : undefined,
  };
}

function isErrorShape(value: unknown): value is WhatsAppBridgeError {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwInvalidResponse(message: string): never {
  throw new WhatsAppBridgeClientError({
    code: "whatsapp_bridge_response_invalid",
    message,
  });
}
