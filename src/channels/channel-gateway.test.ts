import { describe, it, expect } from "vitest";
import { ChannelGateway, InMemoryChannelSessionStore, telegramGatewayCommands, authorizeChannelMessage } from "./channel-gateway.js";
import { createFakeTelegramAdapter } from "../test/fakes/fake-telegram-adapter.js";
import { InMemorySurfacePointerStore } from "./surface-pointer-store.js";
import type { ChannelMessage, ChannelSessionKey } from "../contracts/channel.js";
import type { Runtime } from "../runtime/create-runtime.js";

function makeMessage(text: string, overrides?: Partial<ChannelMessage>): ChannelMessage {
  const sessionKey: ChannelSessionKey = {
    platform: "telegram",
    chatId: "123456",
    userId: "user-1"
  };
  return {
    id: "msg-1",
    channel: "telegram",
    sessionKey,
    sender: { id: "user-1", displayName: "Test User" },
    text,
    receivedAt: new Date().toISOString(),
    ...overrides
  };
}

function createMinimalRuntime(): Runtime {
  return {
    describe: () => "minimal",
    tools: () => [],
    skills: () => [],
    latestResumeNote: async () => undefined,
    inspectMemoryPromotions: async () => [],
    inspectMcpServers: () => [],
    handle: async () =>
      ({
        label: "ok",
        text: "ok",
        matchedSkills: [],
        intent: {
          labels: ["general"],
          confidence: 1,
          nativeIntent: "general",
          suggestedToolsets: [],
          suggestedSkills: [],
          confirmationRequired: false,
          evidence: [],
          rationale: ""
        },
        securityDecision: "allow",
        toolExecutions: [],
        toolPlans: [],
        skillOutcomes: [],
        artifacts: [],
        context: undefined,
        projectContext: undefined,
        progress: []
      }) as unknown as Awaited<ReturnType<Runtime["handle"]>>,
    trustWorkspace: async () => {},
    isWorkspaceTrusted: async () => false,
    revokeWorkspaceTrust: async () => false,
    dispose: async () => {},
    sessionDb: {
      createSession: async (input) => ({
        id: input.id ?? "sess-1",
        profileId: input.profileId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: input.metadata
      }),
      getSession: async () => undefined,
      listSessions: async () => [],
      appendMessage: async (input) => ({
        id: "msg-1",
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        createdAt: new Date().toISOString(),
        channel: input.channel,
        metadata: input.metadata
      }),
      appendEvent: async () => {},
      listMessages: async () => [],
      listEvents: async () => [],
      search: async () => []
    },
    sessionId: "sess-1"
  } as Runtime;
}

describe("ChannelGateway commands", () => {
  describe("/sethome", () => {
    it("sets home delivery to current chat by default", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const pointerStore = new InMemorySurfacePointerStore();
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" },
        surfacePointerStore: pointerStore
      });

      const result = await gateway.receive(makeMessage("/sethome"));
      expect(result.replyText).toContain("telegram:123456");

      const pointer = await pointerStore.getPointer("telegram", "123456");
      expect(pointer?.homeDelivery).toBe("telegram:123456");
    });

    it("sets home delivery to local when requested", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const pointerStore = new InMemorySurfacePointerStore();
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" },
        surfacePointerStore: pointerStore
      });

      const result = await gateway.receive(makeMessage("/sethome local"));
      expect(result.replyText).toContain("local");

      const pointer = await pointerStore.getPointer("telegram", "123456");
      expect(pointer?.homeDelivery).toBe("local");
    });

    it("clears home delivery when requested", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const pointerStore = new InMemorySurfacePointerStore();
      await pointerStore.setPointer("telegram", "123456", {
        sessionId: "sess-1",
        attachedAt: new Date().toISOString(),
        homeDelivery: "telegram:123456"
      });

      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" },
        surfacePointerStore: pointerStore
      });

      const result = await gateway.receive(makeMessage("/sethome clear"));
      expect(result.replyText).toContain("Cleared");

      const pointer = await pointerStore.getPointer("telegram", "123456");
      expect(pointer?.homeDelivery).toBeUndefined();
    });

    it("returns error when surface pointer store is missing", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      const result = await gateway.receive(makeMessage("/sethome"));
      expect(result.replyText).toContain("not configured");
    });
  });

  describe("/diagnostics", () => {
    it("returns diagnostics from provider when available", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" },
        diagnostics: async () => "Diagnostics: ok"
      });

      const result = await gateway.receive(makeMessage("/diagnostics"));
      expect(result.replyText).toBe("Diagnostics: ok");
    });

    it("returns fallback when no diagnostics provider is configured", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      const result = await gateway.receive(makeMessage("/diagnostics"));
      expect(result.replyText).toContain("No diagnostics provider configured");
      expect(result.replyText).toContain("telegram");
    });
  });

  describe("/status", () => {
    it("shows attached state with home delivery", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const pointerStore = new InMemorySurfacePointerStore();
      await pointerStore.setPointer("telegram", "123456", {
        sessionId: "sess-linked",
        attachedAt: "2024-01-01T00:00:00Z",
        homeDelivery: "local"
      });

      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" },
        surfacePointerStore: pointerStore
      });

      const result = await gateway.receive(makeMessage("/status"));
      expect(result.replyText).toContain("Attached to: sess-linked");
      expect(result.replyText).toContain("Home delivery: local");
    });

    it("shows independent state when not attached", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async () => createMinimalRuntime(),
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      const result = await gateway.receive(makeMessage("/status"));
      expect(result.replyText).toContain("independent");
      expect(result.replyText).not.toContain("Attached to:");
    });
  });

  describe("channel-triggered run metadata", () => {
    it("passes source metadata to runtime factory", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      let capturedMetadata: Record<string, unknown> | undefined;

      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async ({ metadata }) => {
          capturedMetadata = metadata;
          return createMinimalRuntime();
        },
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      await gateway.receive(makeMessage("hello"));
      expect(capturedMetadata).toBeDefined();
      expect(capturedMetadata?.surfaceType).toBe("telegram");
      expect(capturedMetadata?.chatId).toBe("123456");
      expect(capturedMetadata?.userId).toBe("user-1");
      expect(capturedMetadata?.origin).toBe("message");
    });

    it("marks command origin for slash-prefixed messages", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      let capturedMetadata: Record<string, unknown> | undefined;

      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async ({ metadata }) => {
          capturedMetadata = metadata;
          return createMinimalRuntime();
        },
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      await gateway.receive(makeMessage("/unknown"));
      expect(capturedMetadata?.origin).toBe("command");
    });

    it("marks message origin for regular messages", async () => {
      const adapter = createFakeTelegramAdapter() as ReturnType<typeof createFakeTelegramAdapter> & { records: Array<{ text?: string }> };
      let capturedMetadata: Record<string, unknown> | undefined;

      const gateway = new ChannelGateway({
        adapters: [adapter],
        runtimeForSession: async ({ metadata }) => {
          capturedMetadata = metadata;
          return createMinimalRuntime();
        },
        sessionStore: new InMemoryChannelSessionStore(),
        authPolicy: { mode: "allow-all" }
      });

      await gateway.receive(makeMessage("hello world"));
      expect(capturedMetadata?.origin).toBe("message");
    });
  });

  describe("telegramGatewayCommands", () => {
    it("includes /sethome and /diagnostics", () => {
      const commands = telegramGatewayCommands();
      const sethome = commands.find((c) => c.command === "/sethome");
      const diagnostics = commands.find((c) => c.command === "/diagnostics");
      expect(sethome).toBeDefined();
      expect(diagnostics).toBeDefined();
    });
  });

  describe("authorizeChannelMessage", () => {
    it("allows messages from allowed user ids", () => {
      const result = authorizeChannelMessage(
        makeMessage("hi"),
        { mode: "allowlist", allowedUserIds: ["user-1"], allowedChatIds: [] }
      );
      expect(result.allowed).toBe(true);
    });

    it("denies messages from unknown users", () => {
      const result = authorizeChannelMessage(
        makeMessage("hi"),
        { mode: "allowlist", allowedUserIds: ["user-2"], allowedChatIds: [] }
      );
      expect(result.allowed).toBe(false);
    });
  });
});
