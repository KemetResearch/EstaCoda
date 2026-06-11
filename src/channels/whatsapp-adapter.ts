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
  type WhatsAppBridgeClient,
  type WhatsAppBridgeInboundMessage,
} from "./whatsapp-bridge-client.js";
import { ManagedWhatsAppBridgeClient } from "./whatsapp-bridge-lifecycle.js";
import { WhatsAppBridgeRuntimeError } from "./whatsapp-bridge-errors.js";
import {
  WHATSAPP_DEFAULT_REPLY_PREFIX,
  normalizeWhatsAppChatId,
  normalizeWhatsAppUserId,
  rememberWhatsAppAlias,
  resolveWhatsAppAlias,
  whatsappChatIdToJid,
} from "./whatsapp-identity.js";

const MAX_RECENT_SENT_IDS = 50;

export type WhatsAppAdapterOptions = {
  /** Directory for WhatsApp bridge/Baileys auth state persistence */
  authDir?: string;
  /** Allowed user phone numbers or JIDs. Gateway auth owns enforcement; this is capability/config metadata only. */
  allowedUsers?: string[];
  /** Profile-local LID/phone alias map. */
  aliasStorePath?: string;
  /** Bot ignores fromMe. Self-chat treats intentional fromMe input as inbound. */
  mode?: WhatsAppChannelConfig["mode"];
  /** Prefix applied to self-chat replies and ignored when echoed back. */
  replyPrefix?: string;
  /** Max characters per message chunk. The bridge owns final chunking in the quarantined transport. */
  maxTextLength?: number;
  /** Directory to save downloaded media */
  mediaRoot?: string;
  /** Enable experimental live WhatsApp adapter */
  experimental?: boolean;
  /** Bridge state file written by the lifecycle manager in later commits */
  bridgeStatePath?: string;
  /** Profile-local bridge stdout/stderr log */
  bridgeLogPath?: string;
  /** Profile-local bridge dependency install log */
  bridgeInstallLogPath?: string;
  /** Profile-local bridge pid file */
  bridgePidPath?: string;
  /** Profile-local bridge session lock file */
  bridgeLockPath?: string;
  /** Standalone bridge package directory */
  bridgeDir?: string;
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
  private recentSentIds: string[] = [];
  private recentSentIdSet = new Set<string>();
  private bridgeClient: WhatsAppBridgeClient;

  constructor(options: WhatsAppAdapterOptions = {}) {
    this.options = options;
    this.missing = options.missing;
    const authDir = options.authDir ?? process.cwd();
    this.bridgeClient = options.bridgeClient ?? new ManagedWhatsAppBridgeClient({
      authDir,
      statePath: options.bridgeStatePath ?? join(authDir, "bridge-state.json"),
      logPath: options.bridgeLogPath,
      installLogPath: options.bridgeInstallLogPath,
      pidPath: options.bridgePidPath,
      lockPath: options.bridgeLockPath,
      bridgeDir: options.bridgeDir,
    });
  }

  getCapabilities(): AdapterCapability {
    const config: WhatsAppChannelConfig = {
      enabled: true,
      authDir: this.options.authDir,
      allowedUsers: this.options.allowedUsers,
      experimental: this.options.experimental,
      mode: this.options.mode,
      replyPrefix: this.options.replyPrefix,
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
    if (health.status === "logged_out") {
      throw new WhatsAppBridgeRuntimeError({
        code: "whatsapp_logged_out",
        message: health.error?.message ?? "WhatsApp bridge is logged out.",
        details: health.error?.details,
      });
    }
    if (health.error !== undefined) {
      throw new WhatsAppBridgeRuntimeError(health.error);
    }
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
      if (this.shouldIgnoreInbound(message)) continue;
      const channelMessage = await bridgeMessageToChannelMessage(message, {
        now: this.options.now,
        aliasStorePath: this.options.aliasStorePath,
      });
      if (channelMessage === undefined) continue;
      await this.handler(channelMessage);
      processed += 1;
    }
    return processed;
  }

  get delivery(): ChannelDelivery {
    return {
      sendText: async (sessionKey: ChannelSessionKey, text: string, _options?: ChannelTextOptions) => {
        const message = this.decorateOutboundText(text);
        const result = await this.bridgeClient.sendText({
          chatId: whatsappChatIdToJid(sessionKey.chatId, { isGroup: sessionKey.chatType === "group" }),
          message,
        });
        if (!result.ok) {
          throw new Error(result.error?.message ?? "WhatsApp bridge text send failed");
        }
        this.rememberSentIds(result.messageIds ?? (result.messageId === undefined ? [] : [result.messageId]));
      },
      sendProgress: async (_sessionKey: ChannelSessionKey, _event: RuntimeEvent) => {
        // WhatsApp is final-only. Progress events must not create visible WhatsApp messages.
      },
      sendArtifact: async (sessionKey: ChannelSessionKey, artifact: ArtifactRecord) => {
        const caption = renderArtifactNotice(artifact);
        if (artifact.path.length === 0) {
          const result = await this.bridgeClient.sendText({
            chatId: whatsappChatIdToJid(sessionKey.chatId, { isGroup: sessionKey.chatType === "group" }),
            message: caption,
          });
          if (!result.ok) {
            throw new Error(result.error?.message ?? "WhatsApp bridge artifact notice failed");
          }
          this.rememberSentIds(result.messageIds ?? (result.messageId === undefined ? [] : [result.messageId]));
          return;
        }

        const result = await this.bridgeClient.sendMedia({
          chatId: whatsappChatIdToJid(sessionKey.chatId, { isGroup: sessionKey.chatType === "group" }),
          filePath: artifact.path,
          mediaType: mediaTypeForArtifact(artifact),
          caption,
          fileName: basename(artifact.path),
        });
        if (!result.ok) {
          throw new Error(result.error?.message ?? "WhatsApp bridge media send failed");
        }
        this.rememberSentIds(result.messageIds ?? (result.messageId === undefined ? [] : [result.messageId]));
      },
    };
  }

  private shouldIgnoreInbound(message: WhatsAppBridgeInboundMessage): boolean {
    if (message.fromMe !== true) return false;
    if (this.recentSentIdSet.has(message.messageId)) return true;
    const mode = this.options.mode ?? "bot";
    if (mode !== "self-chat") return true;
    const prefix = this.selfChatReplyPrefix();
    return prefix.length > 0 && (message.body ?? "").startsWith(prefix);
  }

  private decorateOutboundText(text: string): string {
    if ((this.options.mode ?? "bot") !== "self-chat") return text;
    return `${this.selfChatReplyPrefix()}${text}`;
  }

  private selfChatReplyPrefix(): string {
    return this.options.replyPrefix ?? WHATSAPP_DEFAULT_REPLY_PREFIX;
  }

  private rememberSentIds(ids: string[]): void {
    for (const id of ids) {
      if (id.length === 0 || this.recentSentIdSet.has(id)) continue;
      this.recentSentIds.push(id);
      this.recentSentIdSet.add(id);
      while (this.recentSentIds.length > MAX_RECENT_SENT_IDS) {
        const evicted = this.recentSentIds.shift();
        if (evicted !== undefined) this.recentSentIdSet.delete(evicted);
      }
    }
  }
}

async function bridgeMessageToChannelMessage(
  message: WhatsAppBridgeInboundMessage,
  options: {
    now: (() => Date) | undefined;
    aliasStorePath: string | undefined;
  }
): Promise<ChannelMessage | undefined> {
  await rememberAliasFromInbound(options.aliasStorePath, message);
  const senderId = await resolveWhatsAppAlias(options.aliasStorePath, message.senderId);
  const chatId = message.isGroup === true
    ? normalizeWhatsAppChatId(message.chatId, { isGroup: true })
    : await resolveWhatsAppAlias(options.aliasStorePath, message.chatId);
  if (senderId.length === 0 || chatId.length === 0) return undefined;
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
      chatId,
      chatType: message.isGroup ? "group" : "dm",
      userId: senderId,
    },
    text: message.body ?? "",
    sender: {
      id: senderId,
      displayName: message.senderName ?? senderId,
    },
    attachments: attachments.length > 0 ? attachments : undefined,
    receivedAt: options.now?.().toISOString() ?? new Date().toISOString(),
    metadata: {
      timestamp: message.timestamp,
      rawChatId: message.chatId,
      rawSenderId: message.senderId,
      fromMe: message.fromMe,
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

async function rememberAliasFromInbound(
  aliasStorePath: string | undefined,
  message: WhatsAppBridgeInboundMessage
): Promise<void> {
  if (message.isGroup === true) return;
  const chat = normalizeWhatsAppUserId(message.chatId);
  const sender = normalizeWhatsAppUserId(message.senderId);
  if (chat.length > 0 && sender.length > 0) {
    await rememberWhatsAppAlias(aliasStorePath, chat, sender);
  }
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
