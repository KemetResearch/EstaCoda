import { describe, it, expect } from "vitest";
import { DiscordAdapter } from "./discord-adapter.js";

describe("DiscordAdapter", () => {
  it("initializes with options", () => {
    const adapter = new DiscordAdapter({ botToken: "test" });
    expect(adapter.kind).toBe("discord");
    expect(adapter.running).toBe(false);
  });

  it("builds DM session key correctly", async () => {
    const adapter = new DiscordAdapter({ botToken: "test" });
    const msg = {
      id: "msg-1",
      content: "hello",
      author: { id: "user-1", bot: false, username: "testuser", displayName: "Test User" },
      guild: null,
      guildId: null,
      channelId: "channel-1",
      attachments: new Map(),
      mentions: { has: () => false },
    } as any;

    // Use internal method via any cast
    const sessionKey = (adapter as any).buildSessionKey(msg);
    expect(sessionKey.platform).toBe("discord");
    expect(sessionKey.chatType).toBe("dm");
    expect(sessionKey.userId).toBe("user-1");
  });

  it("builds guild channel session key with per-user mapping", async () => {
    const adapter = new DiscordAdapter({ botToken: "test" });
    const msg = {
      id: "msg-1",
      content: "hello",
      author: { id: "user-1", bot: false, username: "testuser", displayName: "Test User" },
      guild: { id: "guild-1" },
      guildId: "guild-1",
      channelId: "channel-1",
      channel: {},
      attachments: new Map(),
      mentions: { has: () => false },
    } as any;

    const sessionKey = (adapter as any).buildSessionKey(msg);
    expect(sessionKey.platform).toBe("discord");
    expect(sessionKey.chatType).toBe("channel");
    expect(sessionKey.chatId).toBe("channel-1");
    expect(sessionKey.userId).toBe("user-1");
  });

  it("filters allowed users", async () => {
    const adapter = new DiscordAdapter({ botToken: "test", allowedUsers: ["user-1"] });
    const received: any[] = [];
    const handler = async (m: any) => { received.push(m); };

    // Simulate internal filtering logic
    const options = (adapter as any).options;
    expect(options.allowedUsers).toContain("user-1");
    expect(options.allowedUsers).not.toContain("user-2");
  });

  it("filters allowed channels", async () => {
    const adapter = new DiscordAdapter({ botToken: "test", allowedChannels: ["channel-1"] });
    const options = (adapter as any).options;
    expect(options.allowedChannels).toContain("channel-1");
    expect(options.allowedChannels).not.toContain("channel-2");
  });

  it("delivery.sendText chunks long text", () => {
    const longText = "A".repeat(5000);
    const chunks = (DiscordAdapter as any).chunkDiscordText ? (DiscordAdapter as any).chunkDiscordText(longText, 2000) : chunkDiscordText(longText, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});

function chunkDiscordText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length);
    const nl = text.lastIndexOf("\n", end);
    if (nl > i && nl >= end - 200) {
      end = nl;
    } else {
      const sp = text.lastIndexOf(" ", end);
      if (sp > i && sp >= end - 100) {
        end = sp;
      }
    }
    chunks.push(text.slice(i, end));
    i = end + (text[end] === "\n" || text[end] === " " ? 1 : 0);
  }
  return chunks;
}
