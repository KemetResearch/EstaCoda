import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscordVoiceBridge } from "./discord-voice-bridge.js";
import type { ChannelMessage } from "../contracts/channel.js";

describe("DiscordVoiceBridge", () => {
  it("joins a voice channel when dependencies, intent, and permissions are available", async () => {
    const destroy = vi.fn();
    const joinVoiceChannel = vi.fn(() => ({ destroy }));
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel,
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn()
        }
      })
    });

    const result = await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        name: "General",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("General");
    expect(joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "voice-1",
      guildId: "guild-1",
      selfDeaf: false,
      selfMute: false
    }));
  });

  it("rejects join before partial connection when Connect is missing", async () => {
    const joinVoiceChannel = vi.fn();
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel,
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn()
        }
      })
    });

    const result = await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: false, Speak: true, UseVAD: true }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-permissions");
    expect(result.content).toContain("Connect");
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("reports missing GuildVoiceStates intent before joining", async () => {
    const joinVoiceChannel = vi.fn();
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel,
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn()
        }
      })
    });

    const result = await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: false,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-intent");
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("reports optional dependency setup errors without loading during construction", async () => {
    const loadDependencies = vi.fn(async () => ({
      ok: false as const,
      missing: ["@discordjs/voice"],
      installHint: "install voice deps"
    }));
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies
    });
    expect(loadDependencies).not.toHaveBeenCalled();

    const result = await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-optional-dependencies");
    expect(result.content).toContain("@discordjs/voice");
  });

  it("plays voice-hinted TTS audio through an active connection", async () => {
    const subscribe = vi.fn();
    const play = vi.fn();
    const createAudioResource = vi.fn((path: string) => ({ path }));
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel: vi.fn(() => ({ destroy: vi.fn(), subscribe })),
          createAudioPlayer: vi.fn(() => ({ play })),
          createAudioResource
        }
      })
    });
    await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    });

    const played = await bridge.playArtifact(
      { platform: "discord", chatId: "text-1", accountId: "guild-1" },
      {
        id: "tts-1",
        path: "/tmp/tts.ogg",
        kind: "audio",
        bytes: 4,
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { deliveryHint: "voice", ephemeral: true }
      }
    );

    expect(played).toBe(true);
    expect(subscribe).toHaveBeenCalled();
    expect(createAudioResource).toHaveBeenCalledWith("/tmp/tts.ogg");
    expect(play).toHaveBeenCalledWith({ path: "/tmp/tts.ogg" });
  });

  it("saves received voice audio under temp and emits a voice attachment message", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-discord-voice-"));
    const emitted: ChannelMessage[] = [];
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot,
      onVoiceMessage: async (message) => {
        emitted.push(message);
      },
      id: () => "audio-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const message = await bridge.receiveAudio({
      sessionKey: { platform: "discord", chatId: "text-1", accountId: "guild-1", userId: "user-1" },
      sender: { id: "user-1" },
      audio: Buffer.from("RIFF"),
      metadata: { guildId: "guild-1", channelId: "text-1" }
    });

    expect(message.attachments?.[0]).toMatchObject({
      kind: "voice",
      status: "ready",
      localPath: join(tempRoot, "discord-voice", "audio-1.wav")
    });
    await expect(readFile(join(tempRoot, "discord-voice", "audio-1.wav"), "utf8")).resolves.toBe("RIFF");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].metadata?.voiceChannel).toBe(true);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("forwards received voice stream audio through the gateway message callback", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-discord-voice-"));
    const emitted: ChannelMessage[] = [];
    let onSpeakingStart: ((userId: string) => void) | undefined;
    const streamHandlers = new Map<string, (chunk?: Buffer) => void>();
    const stream = {
      on: vi.fn((event: string, handler: (chunk?: Buffer) => void) => {
        streamHandlers.set(event, handler);
      })
    };
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot,
      onVoiceMessage: async (message) => {
        emitted.push(message);
      },
      id: () => "stream-1",
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel: vi.fn(() => ({
            destroy: vi.fn(),
            receiver: {
              speaking: {
                on: (_event: string, handler: (userId: string) => void) => {
                  onSpeakingStart = handler;
                }
              },
              subscribe: vi.fn(() => stream)
            }
          })),
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn(),
          decodeOpusPacketsToWav: vi.fn(async () => Buffer.from("RIFF....WAVEfmt data")),
          EndBehaviorType: { AfterSilence: "after-silence" }
        }
      })
    });

    await bridge.join({
      guildId: "guild-1",
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    });
    onSpeakingStart?.("speaker-1");
    streamHandlers.get("data")?.(Buffer.from("OPUS"));
    streamHandlers.get("end")?.();
    await waitFor(() => emitted.length === 1);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      channel: "discord",
      sessionKey: {
        platform: "discord",
        chatId: "text-1",
        accountId: "guild-1",
        userId: "speaker-1"
      },
      metadata: {
        guildId: "guild-1",
        channelId: "text-1",
        voiceChannel: true
      }
    });
    expect(emitted[0].attachments?.[0]).toMatchObject({
      kind: "voice",
      mimeType: "audio/wav",
      localPath: join(tempRoot, "discord-voice", "stream-1.wav")
    });
  });

  it("does not emit raw Opus packets when decoder support is unavailable", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-discord-voice-"));
    const emitted: ChannelMessage[] = [];
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot,
      onVoiceMessage: async (message) => {
        emitted.push(message);
      },
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel: vi.fn(() => ({ destroy: vi.fn() })),
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn()
        }
      })
    });

    const result = await bridge.receiveOpusPackets({
      sessionKey: { platform: "discord", chatId: "text-1", accountId: "guild-1", userId: "user-1" },
      sender: { id: "user-1" },
      packets: [Buffer.from("OPUS")],
      metadata: { guildId: "guild-1", channelId: "text-1" }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-voice-decoder");
    expect(emitted).toHaveLength(0);
  });

  it("fails closed when Opus decoding throws", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-discord-voice-"));
    const emitted: ChannelMessage[] = [];
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot,
      onVoiceMessage: async (message) => {
        emitted.push(message);
      },
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel: vi.fn(() => ({ destroy: vi.fn() })),
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn(),
          decodeOpusPacketsToWav: vi.fn(async () => {
            throw new Error("bad opus packet");
          })
        }
      })
    });

    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    try {
      const result = await bridge.receiveOpusPackets({
        sessionKey: { platform: "discord", chatId: "text-1", accountId: "guild-1", userId: "user-1" },
        sender: { id: "user-1" },
        packets: [Buffer.from("OPUS")],
        metadata: { guildId: "guild-1", channelId: "text-1" }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("voice-decode-failed");
      expect(emitted).toHaveLength(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("reports stream receive decode failures without emitting gateway audio", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-discord-voice-"));
    const emitted: ChannelMessage[] = [];
    const errors: string[] = [];
    let onSpeakingStart: ((userId: string) => void) | undefined;
    const streamHandlers = new Map<string, (...args: any[]) => void>();
    const stream = {
      on: (event: string, handler: (...args: any[]) => void) => {
        streamHandlers.set(event, handler);
        return stream;
      }
    };
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot,
      onVoiceMessage: async (message) => {
        emitted.push(message);
      },
      onVoiceReceiveError: (error) => {
        if (error.reason) errors.push(error.reason);
      },
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel: vi.fn(() => ({
            destroy: vi.fn(),
            receiver: {
              speaking: {
                on: (_event: string, handler: (userId: string) => void) => {
                  onSpeakingStart = handler;
                }
              },
              subscribe: vi.fn(() => stream)
            }
          })),
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn(),
          decodeOpusPacketsToWav: vi.fn(async () => {
            throw new Error("decoder crashed");
          }),
          EndBehaviorType: { AfterSilence: "after-silence" }
        }
      })
    });

    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    try {
      await bridge.join({
        guildId: "guild-1",
        textChannelId: "text-1",
        userId: "user-1",
        hasGuildVoiceStatesIntent: true,
        adapterCreator: {},
        voiceChannel: {
          id: "voice-1",
          permissions: { Connect: true, Speak: true, UseVAD: true }
        }
      });
      onSpeakingStart?.("speaker-1");
      streamHandlers.get("data")?.(Buffer.from("OPUS"));
      streamHandlers.get("end")?.();
      await waitFor(() => errors.includes("voice-decode-failed"));

      expect(errors).toContain("voice-decode-failed");
      expect(emitted).toHaveLength(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("continues cleanup when a connection destroy throws", async () => {
    const destroyOne = vi.fn(() => {
      throw new Error("destroy failed");
    });
    const destroyTwo = vi.fn();
    const joinVoiceChannel = vi.fn()
      .mockReturnValueOnce({ destroy: destroyOne })
      .mockReturnValueOnce({ destroy: destroyTwo });
    const bridge = new DiscordVoiceBridge({
      enabled: true,
      tempRoot: await mkdtemp(join(tmpdir(), "estacoda-discord-voice-")),
      loadDependencies: async () => ({
        ok: true,
        deps: {
          joinVoiceChannel,
          createAudioPlayer: vi.fn(),
          createAudioResource: vi.fn()
        }
      })
    });
    const input = {
      textChannelId: "text-1",
      userId: "user-1",
      hasGuildVoiceStatesIntent: true,
      adapterCreator: {},
      voiceChannel: {
        id: "voice-1",
        permissions: { Connect: true, Speak: true, UseVAD: true }
      }
    };
    await bridge.join({ ...input, guildId: "guild-1" });
    await bridge.join({ ...input, guildId: "guild-2" });

    await expect(bridge.leaveAll()).resolves.toBeUndefined();

    expect(destroyOne).toHaveBeenCalled();
    expect(destroyTwo).toHaveBeenCalled();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
