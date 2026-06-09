import { readFile } from "node:fs/promises";
import type { ChannelAttachmentKind } from "../contracts/channel.js";

export type WhatsAppBridgeHealth = {
  ok: boolean;
  status?: "connected" | "disconnected" | "connecting" | "logged_out" | "error";
  queueLength?: number;
  droppedMessages?: number;
  uptimeSeconds?: number;
  version?: string;
  error?: WhatsAppBridgeError;
};

export type WhatsAppBridgeError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type WhatsAppBridgeInboundAttachment = {
  id?: string;
  kind: ChannelAttachmentKind;
  status?: "ready" | "unsupported" | "too-large" | "download-failed" | "missing-file";
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
  sendMedia(input: WhatsAppBridgeSendMediaInput): Promise<WhatsAppBridgeSendResult>;
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
};

export class WhatsAppBridgeClientError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(error: WhatsAppBridgeError) {
    super(error.message);
    this.name = "WhatsAppBridgeClientError";
    this.code = error.code;
    this.details = error.details;
  }
}

export class HttpWhatsAppBridgeClient implements WhatsAppBridgeClient {
  readonly #statePath: string | undefined;
  readonly #baseUrl: string | undefined;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: HttpWhatsAppBridgeClientOptions = {}) {
    this.#statePath = options.statePath;
    this.#baseUrl = options.baseUrl;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async getHealth(): Promise<WhatsAppBridgeHealth> {
    return this.#request<WhatsAppBridgeHealth>("GET", "/health");
  }

  async pollMessages(): Promise<WhatsAppBridgeInboundMessage[]> {
    return this.#request<WhatsAppBridgeInboundMessage[]>("GET", "/messages");
  }

  async sendText(input: WhatsAppBridgeSendTextInput): Promise<WhatsAppBridgeSendResult> {
    return this.#request<WhatsAppBridgeSendResult>("POST", "/send", input);
  }

  async sendMedia(input: WhatsAppBridgeSendMediaInput): Promise<WhatsAppBridgeSendResult> {
    return this.#request<WhatsAppBridgeSendResult>("POST", "/send-media", input);
  }

  async #request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const state = await this.#resolveState();
    const response = await this.#fetch(new URL(path, state.baseUrl), {
      method,
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${state.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      throw new WhatsAppBridgeClientError(normalizeBridgeError(parsed, response.status));
    }
    if (isBridgeErrorEnvelope(parsed)) {
      throw new WhatsAppBridgeClientError(parsed.error);
    }
    return parsed as T;
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
      return error as WhatsAppBridgeError;
    }
    if (typeof error === "string") {
      return { code: `http_${status}`, message: error };
    }
  }
  return { code: `http_${status}`, message: `WhatsApp bridge request failed with HTTP ${status}.` };
}
