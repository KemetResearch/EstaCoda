import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhatsAppAdapter } from "./whatsapp-adapter.js";
import { buildAdapterCapability } from "./adapter-capability.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { ChannelMessage } from "../contracts/channel.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type {
  WhatsAppBridgeClient,
  WhatsAppBridgeHealth,
  WhatsAppBridgeInboundMessage,
  WhatsAppBridgeEditInput,
  WhatsAppBridgeSendMediaInput,
  WhatsAppBridgeSendTextInput,
  WhatsAppBridgeTypingInput,
} from "./whatsapp-bridge-client.js";

class FakeWhatsAppBridgeClient implements WhatsAppBridgeClient {
  health: WhatsAppBridgeHealth = { ok: true, apiVersion: "whatsapp-bridge.v1", status: "connected" };
  messages: WhatsAppBridgeInboundMessage[] = [];
  sentText: WhatsAppBridgeSendTextInput[] = [];
  edited: WhatsAppBridgeEditInput[] = [];
  sentMedia: WhatsAppBridgeSendMediaInput[] = [];
  typing: WhatsAppBridgeTypingInput[] = [];
  started = false;
  stopped = false;
  sendTextOk = true;
  sendMediaOk = true;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async getHealth(): Promise<WhatsAppBridgeHealth> {
    return this.health;
  }

  async pollMessages(): Promise<WhatsAppBridgeInboundMessage[]> {
    return this.messages.splice(0, this.messages.length);
  }

  async sendText(input: WhatsAppBridgeSendTextInput) {
    this.sentText.push(input);
    return this.sendTextOk
      ? { ok: true, messageId: "text-1", messageIds: ["text-1"] }
      : { ok: false, error: { code: "send_failed", message: "Text send failed" } };
  }

  async sendMedia(input: WhatsAppBridgeSendMediaInput) {
    this.sentMedia.push(input);
    return this.sendMediaOk
      ? { ok: true, messageId: "media-1", messageIds: ["media-1"] }
      : { ok: false, error: { code: "media_failed", message: "Media send failed" } };
  }

  async editMessage(input: WhatsAppBridgeEditInput) {
    this.edited.push(input);
    return { ok: true, messageId: input.messageId, messageIds: [input.messageId] };
  }

  async sendTyping(input: WhatsAppBridgeTypingInput) {
    this.typing.push(input);
    return { ok: true };
  }

  async getChat(chatId: string) {
    return { id: chatId };
  }
}

describe("WhatsAppAdapter", () => {
  let tmpDir: string;
  let bridge: FakeWhatsAppBridgeClient;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "estacoda-wa-test-"));
    bridge = new FakeWhatsAppBridgeClient();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createAdapter(opts: Partial<ConstructorParameters<typeof WhatsAppAdapter>[0]> = {}) {
    return new WhatsAppAdapter({
      authDir: join(tmpDir, "auth"),
      mediaRoot: join(tmpDir, "media"),
      experimental: true,
      bridgeClient: bridge,
      ...opts,
    });
  }

  it("throws if experimental flag is not set", async () => {
    const adapter = createAdapter({ experimental: false });
    await expect(adapter.start(async () => {})).rejects.toThrow(
      "WhatsApp live adapter is experimental. Set experimental: true in config to enable."
    );
  });

  it("getCapabilities returns static whatsapp bridge traits", () => {
    const adapter = createAdapter();
    const cap = adapter.getCapabilities!();
    expect(cap.kind).toBe("whatsapp");
    expect(cap.enabled).toBe(true);
    expect(cap.experimental).toBe(true);
    expect(cap.inboundMode).toBe("polling");
    expect(cap.supportsAttachments).toBe(false);
    expect(cap.supportsProgressStreaming).toBe(false);
    expect(cap.implementationStatus).toBe("present_not_live_proven");
  });

  it("getCapabilities reflects missing config", () => {
    const adapter = createAdapter({ missing: ["bridgeDependencies"] });
    const cap = adapter.getCapabilities!();
    expect(cap.enabled).toBe(true);
    expect(cap.configured).toBe(false);
    expect(cap.missingConfig).toEqual(["bridgeDependencies"]);
  });

  it("getCapabilities delegates to shared builder", () => {
    const authDir = join(tmpDir, "auth");
    const adapter = createAdapter({ authDir, missing: ["bridgeDependencies"] });
    const cap = adapter.getCapabilities!();
    const expected = buildAdapterCapability({
      kind: "whatsapp",
      config: { enabled: true, authDir, experimental: true },
      missing: ["bridgeDependencies"],
    });
    expect(cap).toEqual(expected);
  });

  it("getCapabilities matches registry output for same normalized config", () => {
    const authDir = join(tmpDir, "auth");
    const channels = {
      telegram: { enabled: false, ready: false },
      discord: { enabled: false, ready: false },
      email: { enabled: false, ready: false },
      whatsapp: { enabled: true, ready: false, experimental: true, authDir, missing: ["bridgeDependencies"] },
    } as unknown as LoadedRuntimeConfig["channels"];

    const adapter = createAdapter({ authDir, missing: ["bridgeDependencies"] });
    const registry = new AdapterRegistry(channels);
    expect(adapter.getCapabilities!()).toEqual(registry.get("whatsapp"));
  });

  it("starts and stops the bridge client", async () => {
    const adapter = createAdapter();
    await adapter.start(async () => {});
    expect(adapter.running).toBe(true);
    expect(adapter.connectionStatus).toBe("open");
    expect(bridge.started).toBe(true);

    await adapter.stop();
    expect(adapter.running).toBe(false);
    expect(adapter.connectionStatus).toBe("close");
    expect(bridge.stopped).toBe(true);
  });

  it("keeps connecting status when bridge is not connected yet", async () => {
    bridge.health = { ok: true, apiVersion: "whatsapp-bridge.v1", status: "connecting" };
    const adapter = createAdapter();
    await adapter.start(async () => {});
    expect(adapter.connectionStatus).toBe("connecting");
  });

  it("polls bridge messages and converts them to channel messages", async () => {
    const adapter = createAdapter();
    bridge.messages.push({
      messageId: "msg-1",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "971501234567@s.whatsapp.net",
      senderName: "Test User",
      body: "Hello from bridge",
      timestamp: 1234567890,
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    const processed = await adapter.pollOnce();

    expect(processed).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.channel).toBe("whatsapp");
    expect(received[0]!.text).toBe("Hello from bridge");
    expect(received[0]!.sessionKey.platform).toBe("whatsapp");
    expect(received[0]!.sessionKey.chatId).toBe("971501234567");
    expect(received[0]!.sessionKey.userId).toBe("971501234567");
    expect(received[0]!.sender.displayName).toBe("Test User");
  });

  it("persists aliases and uses canonical IDs for allowlist/session matching", async () => {
    const adapter = createAdapter({ aliasStorePath: join(tmpDir, "gateway", "whatsapp-identity-aliases.json") });
    bridge.messages.push({
      messageId: "msg-lid",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "ABC123@lid",
      senderName: "Linked User",
      body: "Hello from linked identity",
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    await adapter.pollOnce();

    expect(received[0]!.sender.id).toBe("971501234567");
    expect(received[0]!.sessionKey.userId).toBe("971501234567");
    expect(received[0]!.sessionKey.chatId).toBe("971501234567");
  });

  it("normalizes group JIDs for session keys", async () => {
    const adapter = createAdapter();
    bridge.messages.push({
      messageId: "msg-group",
      chatId: "120363025555555555@g.us",
      senderId: "971501234567@s.whatsapp.net",
      body: "group hello",
      isGroup: true,
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    await adapter.pollOnce();

    expect(received[0]!.sessionKey.chatType).toBe("group");
    expect(received[0]!.sessionKey.chatId).toBe("120363025555555555@g.us");
    expect(received[0]!.sessionKey.userId).toBe("971501234567");
  });

  it("drops invalid WhatsApp identities before creating session keys", async () => {
    const adapter = createAdapter();
    bridge.messages.push(
      {
        messageId: "invalid-dm",
        chatId: "not a whatsapp chat",
        senderId: "not a whatsapp sender",
        body: "bad dm",
      },
      {
        messageId: "invalid-group",
        chatId: "not-a-group",
        senderId: "971501234567@s.whatsapp.net",
        body: "bad group",
        isGroup: true,
      }
    );
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    const processed = await adapter.pollOnce();

    expect(processed).toBe(0);
    expect(received).toEqual([]);
  });

  it("does not silently drop users before gateway authorization", async () => {
    const adapter = createAdapter({ allowedUsers: ["971501234567"] });
    bridge.messages.push({
      messageId: "msg-2",
      chatId: "971509999999@s.whatsapp.net",
      senderId: "971509999999@s.whatsapp.net",
      senderName: "Stranger",
      body: "Unauthorized should reach gateway",
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    await adapter.pollOnce();

    expect(received).toHaveLength(1);
    expect(received[0]!.sender.id).toBe("971509999999");
  });

  it("deduplicates bridge messages by message id", async () => {
    const adapter = createAdapter();
    bridge.messages.push(
      { messageId: "msg-3", chatId: "971501234567@s.whatsapp.net", senderId: "971501234567@s.whatsapp.net", body: "one" },
      { messageId: "msg-3", chatId: "971501234567@s.whatsapp.net", senderId: "971501234567@s.whatsapp.net", body: "one again" }
    );
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    const processed = await adapter.pollOnce();

    expect(processed).toBe(1);
    expect(received).toHaveLength(1);
  });

  it("ignores fromMe messages in bot mode", async () => {
    const adapter = createAdapter({ mode: "bot" });
    bridge.messages.push({
      messageId: "self-1",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "971501234567@s.whatsapp.net",
      body: "manual self message",
      fromMe: true,
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    const processed = await adapter.pollOnce();

    expect(processed).toBe(0);
    expect(received).toEqual([]);
  });

  it("accepts intentional fromMe input in self-chat mode", async () => {
    const adapter = createAdapter({ mode: "self-chat" });
    bridge.messages.push({
      messageId: "self-2",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "971501234567@s.whatsapp.net",
      body: "intentional prompt",
      fromMe: true,
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    const processed = await adapter.pollOnce();

    expect(processed).toBe(1);
    expect(received[0]!.text).toBe("intentional prompt");
  });

  it("applies self-chat reply prefix only in self-chat mode and ignores prefix echoes", async () => {
    const selfChat = createAdapter({ mode: "self-chat", replyPrefix: "Bot: " });
    await selfChat.start(async () => {});

    await selfChat.delivery!.sendText(
      { platform: "whatsapp", chatId: "971501234567", userId: "971501234567", chatType: "dm" },
      "Hello"
    );

    expect(bridge.sentText[0]!.message).toBe("Bot: Hello");

    bridge.messages.push({
      messageId: "prefix-echo",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "971501234567@s.whatsapp.net",
      body: "Bot: Hello",
      fromMe: true,
    });
    const received: ChannelMessage[] = [];
    await selfChat.stop();
    await selfChat.start(async (msg) => {
      received.push(msg);
    });

    expect(await selfChat.pollOnce()).toBe(0);
    expect(received).toEqual([]);

    const botBridge = new FakeWhatsAppBridgeClient();
    const bot = createAdapter({ mode: "bot", bridgeClient: botBridge });
    await bot.start(async () => {});
    await bot.delivery!.sendText(
      { platform: "whatsapp", chatId: "971501234567", userId: "971501234567", chatType: "dm" },
      "Hello"
    );
    expect(botBridge.sentText[0]!.message).toBe("Hello");
  });

  it("tracks recent sent ids for self-chat echo prevention with FIFO eviction", async () => {
    const adapter = createAdapter({ mode: "self-chat", replyPrefix: "" });
    await adapter.start(async () => {});
    for (let i = 0; i < 51; i += 1) {
      bridge.sendText = async (input) => {
        bridge.sentText.push(input);
        return { ok: true, messageId: `sent-${i}`, messageIds: [`sent-${i}`] };
      };
      await adapter.delivery!.sendText(
        { platform: "whatsapp", chatId: "971501234567", userId: "971501234567", chatType: "dm" },
        `message ${i}`
      );
    }
    const received: ChannelMessage[] = [];
    await adapter.stop();
    await adapter.start(async (msg) => {
      received.push(msg);
    });
    bridge.messages.push(
      {
        messageId: "sent-0",
        chatId: "971501234567@s.whatsapp.net",
        senderId: "971501234567@s.whatsapp.net",
        body: "evicted manual input",
        fromMe: true,
      },
      {
        messageId: "sent-50",
        chatId: "971501234567@s.whatsapp.net",
        senderId: "971501234567@s.whatsapp.net",
        body: "recent echo",
        fromMe: true,
      }
    );

    const processed = await adapter.pollOnce();

    expect(processed).toBe(1);
    expect(received.map((message) => message.id)).toEqual(["sent-0"]);
  });

  it("preserves bridge attachments", async () => {
    const adapter = createAdapter();
    bridge.messages.push({
      messageId: "msg-4",
      chatId: "971501234567@s.whatsapp.net",
      senderId: "971501234567@s.whatsapp.net",
      body: "",
      attachments: [
        {
          id: "att-1",
          kind: "image",
          status: "ready",
          mimeType: "image/jpeg",
          originalName: "photo.jpg",
          localPath: join(tmpDir, "media", "photo.jpg"),
          bytes: 123,
        },
      ],
    });
    const received: ChannelMessage[] = [];
    await adapter.start(async (msg) => {
      received.push(msg);
    });

    await adapter.pollOnce();

    expect(received[0]!.attachments).toEqual([
      expect.objectContaining({
        id: "att-1",
        kind: "image",
        status: "ready",
        mimeType: "image/jpeg",
        bytes: 123,
      }),
    ]);
  });

  it("delivery.sendText delegates to bridge client", async () => {
    const adapter = createAdapter();
    await adapter.start(async () => {});

    await adapter.delivery!.sendText(
      { platform: "whatsapp", chatId: "971501234567@s.whatsapp.net", userId: "971501234567", chatType: "dm" },
      "Hello"
    );

    expect(bridge.sentText).toEqual([
      { chatId: "971501234567@s.whatsapp.net", message: "Hello" },
    ]);
  });

  it("delivery.sendText throws when bridge send fails", async () => {
    const adapter = createAdapter();
    bridge.sendTextOk = false;
    await adapter.start(async () => {});

    await expect(
      adapter.delivery!.sendText(
        { platform: "whatsapp", chatId: "971501234567@s.whatsapp.net", userId: "971501234567", chatType: "dm" },
        "Hello"
      )
    ).rejects.toThrow("Text send failed");
  });

  it("delivery.sendProgress is final-only and sends nothing", async () => {
    const adapter = createAdapter();
    await adapter.start(async () => {});

    await adapter.delivery!.sendProgress!(
      { platform: "whatsapp", chatId: "971501234567@s.whatsapp.net", userId: "971501234567", chatType: "dm" },
      { kind: "tool-start", tool: "web_search" }
    );

    expect(bridge.sentText).toHaveLength(0);
    expect(bridge.sentMedia).toHaveLength(0);
  });

  it("delivery.sendArtifact delegates path artifacts to bridge media send", async () => {
    const adapter = createAdapter();
    await adapter.start(async () => {});

    await adapter.delivery!.sendArtifact!(
      { platform: "whatsapp", chatId: "971501234567@s.whatsapp.net", userId: "971501234567", chatType: "dm" },
      { id: "art-1", path: "/tmp/report.pdf", mimeType: "application/pdf", kind: "document", bytes: 1024, createdAt: new Date().toISOString() }
    );

    expect(bridge.sentMedia).toEqual([
      expect.objectContaining({
        chatId: "971501234567@s.whatsapp.net",
        filePath: "/tmp/report.pdf",
        mediaType: "document",
        fileName: "report.pdf",
      }),
    ]);
  });

  it("delivery.sendArtifact delegates pathless artifacts to bridge text send", async () => {
    const adapter = createAdapter();
    await adapter.start(async () => {});

    await adapter.delivery!.sendArtifact!(
      { platform: "whatsapp", chatId: "971501234567@s.whatsapp.net", userId: "971501234567", chatType: "dm" },
      { id: "art-2", path: "", mimeType: "text/plain", kind: "document", bytes: 24, createdAt: new Date().toISOString() }
    );

    expect(bridge.sentText[0]!.message).toContain("art-2");
  });
});
