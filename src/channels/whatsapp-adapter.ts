import { basename, join } from "node:path";
import type { ArtifactRecord } from "../contracts/artifact.js";
import type {
  AdapterCapability,
  ChannelAdapter,
  ChannelAttachment,
  ChannelDelivery,
  ChannelMessage,
  ChannelSessionKey,
  ChannelTextOptions,
} from "../contracts/channel.js";
import type { RuntimeEvent } from "../contracts/runtime-event.js";
import type { WhatsAppChannelConfig } from "../config/runtime-config.js";
import { buildAdapterCapability } from "./adapter-capability.js";
import {
  HttpWhatsAppBridgeClient,
  type WhatsAppBridgeClient,
  type WhatsAppBridgeInboundMessage,
} from "./whatsapp-bridge-client.js";

export type WhatsAppAdapterOptions = {
  /** Directory for WhatsApp bridge/Baileys auth state persistence */
  authDir?: string;
  /** Allowed user phone numbers or JIDs. Gateway auth owns enforcement; this is capability/config metadata only. */
  allowedUsers?: string[];
  /** Max characters per message chunk. The bridge owns final chunking in the quarantined transport. */
  maxTextLength?: number;
  /** Directory to save downloaded media */
  mediaRoot?: string;
  /** Enable experimental live WhatsApp adapter */
  experimental?: boolean;
  /** Bridge state file written by the lifecycle manager in later commits */
  bridgeStatePath?: string;
  /** Inject a fake or custom bridge client for tests */
  bridgeClient?: WhatsAppBridgeClient;
  now?: () => Date;
  missing?: string[];
};

type ConnectionStatus =
  | "connecting"
  | "open"
  | "close"
  | "error";

/**
 * WhatsApp adapter backed by the quarantined Node.js bridge.
 *
 * This root-runtime adapter intentionally imports no Baileys or Boom symbols.
 * Baileys socket lifecycle and disconnect details live under scripts/whatsapp-bridge/.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  kind = "whatsapp" as const;
  running = false;
  connectionStatus: ConnectionStatus = "close";
  lastError?: string;

  private handler?: (message: ChannelMessage) => Promise<void>;
  private options: WhatsAppAdapterOptions;
  private missing: string[] | undefined;
  private seenMessageIds = new Set<string>();
  private bridgeClient: WhatsAppBridgeClient;

  constructor(options: WhatsAppAdapterOptions = {}) {
    this.options = options;
    this.missing = options.missing;
    this.bridgeClient = options.bridgeClient ?? new HttpWhatsAppBridgeClient({
      statePath: options.bridgeStatePath ?? join(options.authDir ?? process.cwd(), "bridge-state.json"),
    });
  }

  getCapabilities(): AdapterCapability {
    const config: WhatsAppChannelConfig = {
      enabled: true,
      authDir: this.options.authDir,
      allowedUsers: this.options.allowedUsers,
      experimental: this.options.experimental,
      busyPolicy: undefined,
      queueDepth: undefined,
    };
    return buildAdapterCapability({ kind: "whatsapp", config, missing: this.missing });
  }

  async start(handler: (message: ChannelMessage) => Promise<void>): Promise<void> {
    if (this.options.experimental !== true) {
      throw new Error("WhatsApp live adapter is experimental. Set experimental: true in config to enable.");
    }
    if (this.running) return;
    this.handler = handler;
    this.running = true;
    this.connectionStatus = "connecting";
    await this.bridgeClient.start?.();
    const health = await this.bridgeClient.getHealth().catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.connectionStatus = "error";
      throw error;
    });
    this.connectionStatus = health.status === "connected" ? "open" : "connecting";
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.connectionStatus = "close";
    await this.bridgeClient.stop?.();
  }

  async pollOnce(): Promise<number> {
    if (!this.running || this.handler === undefined) return 0;
    const messages = await this.bridgeClient.pollMessages();
    let processed = 0;
    for (const message of messages) {
      if (this.seenMessageIds.has(message.messageId)) continue;
      this.seenMessageIds.add(message.messageId);
      await this.handler(bridgeMessageToChannelMessage(message, this.options.now));
      processed += 1;
    }
    return processed;
  }

  get delivery(): ChannelDelivery {
    return {
      sendText: async (sessionKey: ChannelSessionKey, text: string, _options?: ChannelTextOptions) => {
        const result = await this.bridgeClient.sendText({
          chatId: sessionKey.chatId,
          message: text,
        });
        if (!result.ok) {
          throw new Error(result.error?.message ?? "WhatsApp bridge text send failed");
        }
      },
      sendProgress: async (_sessionKey: ChannelSessionKey, _event: RuntimeEvent) => {
        // WhatsApp is final-only. Progress events must not create visible WhatsApp messages.
      },
      sendArtifact: async (sessionKey: ChannelSessionKey, artifact: ArtifactRecord) => {
        const caption = renderArtifactNotice(artifact);
        if (artifact.path.length === 0) {
          const result = await this.bridgeClient.sendText({
            chatId: sessionKey.chatId,
            message: caption,
          });
          if (!result.ok) {
            throw new Error(result.error?.message ?? "WhatsApp bridge artifact notice failed");
          }
          return;
        }

        const result = await this.bridgeClient.sendMedia({
          chatId: sessionKey.chatId,
          filePath: artifact.path,
          mediaType: mediaTypeForArtifact(artifact),
          caption,
          fileName: basename(artifact.path),
        });
        if (!result.ok) {
          throw new Error(result.error?.message ?? "WhatsApp bridge media send failed");
        }
      },
    };
  }
}

function bridgeMessageToChannelMessage(
  message: WhatsAppBridgeInboundMessage,
  now: (() => Date) | undefined
): ChannelMessage {
  const senderId = normalizeWhatsAppSender(message.senderId);
  const attachments = (message.attachments ?? []).map<ChannelAttachment>((attachment) => ({
    id: attachment.id ?? `${message.messageId}:attachment`,
    kind: attachment.kind,
    status: attachment.status,
    failureCode: attachment.failureCode,
    failureMessage: attachment.failureMessage,
    mimeType: attachment.mimeType,
    originalName: attachment.originalName,
    localPath: attachment.localPath,
    bytes: attachment.bytes,
    metadata: attachment.metadata,
  }));

  return {
    id: message.messageId,
    channel: "whatsapp",
    sessionKey: {
      platform: "whatsapp",
      chatId: message.chatId,
      chatType: message.isGroup ? "group" : "dm",
      userId: senderId,
    },
    text: message.body ?? "",
    sender: {
      id: senderId,
      displayName: message.senderName ?? senderId,
    },
    attachments: attachments.length > 0 ? attachments : undefined,
    receivedAt: now?.().toISOString() ?? new Date().toISOString(),
    metadata: {
      timestamp: message.timestamp,
      chatName: message.chatName,
      mentionedIds: message.mentionedIds,
      quotedMessageId: message.quotedMessageId,
      quotedParticipant: message.quotedParticipant,
      quotedRemoteJid: message.quotedRemoteJid,
      hasQuotedMessage: message.hasQuotedMessage,
      botIds: message.botIds,
      ...(message.metadata ?? {}),
    },
  };
}

function normalizeWhatsAppSender(senderId: string): string {
  return senderId.replace(/@s\.whatsapp\.net$/u, "").replace(/@lid$/u, "");
}

function mediaTypeForArtifact(artifact: ArtifactRecord): "image" | "video" | "audio" | "document" {
  if (artifact.kind === "image" || artifact.mimeType?.startsWith("image/")) return "image";
  if (artifact.kind === "video" || artifact.mimeType?.startsWith("video/")) return "video";
  if (artifact.kind === "audio" || artifact.mimeType?.startsWith("audio/")) return "audio";
  return "document";
}

function renderArtifactNotice(artifact: ArtifactRecord): string {
  const parts: string[] = [];
  parts.push(`Artifact: ${artifact.id}`);
  if (artifact.path) parts.push(`Path: ${artifact.path}`);
  if (artifact.mimeType) parts.push(`Type: ${artifact.mimeType}`);
  if (artifact.kind) parts.push(`Kind: ${artifact.kind}`);
  return parts.join("\n");
}
