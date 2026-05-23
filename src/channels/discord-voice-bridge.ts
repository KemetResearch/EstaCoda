import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ArtifactRecord } from "../contracts/artifact.js";
import type { ChannelMessage, ChannelSessionKey } from "../contracts/channel.js";

export type DiscordVoiceCommandResult = {
  ok: boolean;
  content: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type DiscordVoiceOptionalDeps = {
  joinVoiceChannel(input: {
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
    selfDeaf?: boolean;
    selfMute?: boolean;
  }): DiscordVoiceConnection;
  createAudioPlayer(): DiscordVoiceAudioPlayer;
  createAudioResource(path: string): unknown;
  decodeOpusPacketsToWav?(packets: Buffer[]): Promise<Buffer>;
  EndBehaviorType?: {
    AfterSilence?: unknown;
  };
};

export type DiscordVoiceConnection = {
  destroy(): void;
  subscribe?(player: DiscordVoiceAudioPlayer): unknown;
  receiver?: unknown;
};

export type DiscordVoiceAudioPlayer = {
  play(resource: unknown): void;
};

export type DiscordVoiceDependencyResult =
  | { ok: true; deps: DiscordVoiceOptionalDeps }
  | { ok: false; missing: string[]; installHint: string };

export type DiscordVoiceJoinInput = {
  guildId?: string | null;
  textChannelId: string;
  userId: string;
  voiceChannel?: {
    id?: string;
    name?: string;
    guildId?: string;
    permissions?: DiscordVoicePermissionSource;
  } | null;
  adapterCreator?: unknown;
  hasGuildVoiceStatesIntent: boolean;
};

export type DiscordVoicePermissionSource = {
  has?: (permission: unknown) => boolean;
  Connect?: boolean;
  Speak?: boolean;
  UseVAD?: boolean;
  connect?: boolean;
  speak?: boolean;
  useVAD?: boolean;
};

export type DiscordVoiceReceiveInput = {
  sessionKey: ChannelSessionKey;
  sender: ChannelMessage["sender"];
  audio: Buffer | Uint8Array;
  mimeType?: string;
  originalName?: string;
  metadata?: Record<string, unknown>;
};

export type DiscordVoiceBridgeOptions = {
  enabled: boolean;
  tempRoot: string;
  loadDependencies?: () => Promise<DiscordVoiceDependencyResult>;
  onVoiceMessage?: (message: ChannelMessage) => Promise<void>;
  onVoiceReceiveError?: (error: DiscordVoiceCommandResult) => void | Promise<void>;
  now?: () => Date;
  id?: () => string;
};

type StoredConnection = {
  guildId: string;
  textChannelId: string;
  connection: DiscordVoiceConnection;
};

const OPTIONAL_VOICE_PACKAGES = ["@discordjs/voice", "@discordjs/opus or opusscript", "libsodium-wrappers or sodium-native"];

export class DiscordVoiceBridge {
  readonly #enabled: boolean;
  readonly #tempRoot: string;
  readonly #loadDependencies: () => Promise<DiscordVoiceDependencyResult>;
  readonly #onVoiceMessage: ((message: ChannelMessage) => Promise<void>) | undefined;
  readonly #onVoiceReceiveError: ((error: DiscordVoiceCommandResult) => void | Promise<void>) | undefined;
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #connections = new Map<string, StoredConnection>();

  constructor(options: DiscordVoiceBridgeOptions) {
    this.#enabled = options.enabled;
    this.#tempRoot = options.tempRoot;
    this.#loadDependencies = options.loadDependencies ?? loadDiscordVoiceDependencies;
    this.#onVoiceMessage = options.onVoiceMessage;
    this.#onVoiceReceiveError = options.onVoiceReceiveError;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => randomUUID());
  }

  async join(input: DiscordVoiceJoinInput): Promise<DiscordVoiceCommandResult> {
    if (!this.#enabled) {
      return setupError("disabled", "Discord voice channels are disabled. Enable channels.discord.voiceChannel.enabled first.");
    }
    if (!input.hasGuildVoiceStatesIntent) {
      return setupError("missing-intent", "Discord voice channels need the GuildVoiceStates intent before joining.");
    }
    if (!input.guildId || !input.adapterCreator) {
      return setupError("missing-guild", "Discord voice channels are available only inside a Discord guild.");
    }
    if (!input.voiceChannel?.id) {
      return setupError("no-voice-channel", "Join a Discord voice channel first, then send /voice channel.");
    }

    const missingPermissions = missingVoicePermissions(input.voiceChannel.permissions);
    if (missingPermissions.length > 0) {
      return setupError(
        "missing-permissions",
        `Discord voice setup is missing bot permissions: ${missingPermissions.join(", ")}.`
      );
    }

    const loaded = await this.#loadDependencies();
    if (!loaded.ok) {
      return setupError(
        "missing-optional-dependencies",
        `Discord voice support needs optional packages: ${loaded.missing.join(", ")}. ${loaded.installHint}`,
        { missing: loaded.missing }
      );
    }

    this.#connections.get(input.guildId)?.connection.destroy();
    const connection = loaded.deps.joinVoiceChannel({
      channelId: input.voiceChannel.id,
      guildId: input.guildId,
      adapterCreator: input.adapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    this.#attachReceiver(connection, loaded.deps, input);
    this.#connections.set(input.guildId, {
      guildId: input.guildId,
      textChannelId: input.textChannelId,
      connection,
    });

    return {
      ok: true,
      content: `Joined Discord voice channel ${input.voiceChannel.name ?? input.voiceChannel.id}.`,
      metadata: { guildId: input.guildId, channelId: input.voiceChannel.id }
    };
  }

  async leave(input: { guildId?: string | null }): Promise<DiscordVoiceCommandResult> {
    if (!input.guildId) {
      return setupError("missing-guild", "Discord voice channel controls are available only inside a Discord guild.");
    }
    const existing = this.#connections.get(input.guildId);
    if (existing === undefined) {
      return { ok: true, content: "No Discord voice channel is currently joined for this guild.", reason: "not-joined" };
    }
    existing.connection.destroy();
    this.#connections.delete(input.guildId);
    return { ok: true, content: "Left the Discord voice channel." };
  }

  async leaveAll(): Promise<void> {
    for (const connection of this.#connections.values()) {
      try {
        connection.connection.destroy();
      } catch {
        // Voice cleanup is best-effort; gateway shutdown must continue.
      }
    }
    this.#connections.clear();
  }

  async playArtifact(sessionKey: ChannelSessionKey, artifact: ArtifactRecord): Promise<boolean> {
    const guildId = typeof artifact.metadata?.guildId === "string"
      ? artifact.metadata.guildId
      : typeof sessionKey.accountId === "string"
        ? sessionKey.accountId
        : undefined;
    const connection = guildId === undefined
      ? firstConnection(this.#connections)
      : this.#connections.get(guildId);
    if (connection === undefined || artifact.metadata?.deliveryHint !== "voice") {
      return false;
    }
    const filePath = artifact.localPath ?? artifact.path;
    if (!filePath) {
      return false;
    }
    const loaded = await this.#loadDependencies();
    if (!loaded.ok) {
      return false;
    }
    const player = loaded.deps.createAudioPlayer();
    const resource = loaded.deps.createAudioResource(filePath);
    connection.connection.subscribe?.(player);
    player.play(resource);
    return true;
  }

  async receiveAudio(input: DiscordVoiceReceiveInput): Promise<ChannelMessage> {
    const dir = join(this.#tempRoot, "discord-voice");
    await mkdir(dir, { recursive: true });
    const id = this.#id();
    const fileName = `${id}${extensionForAudio(input.mimeType, input.originalName)}`;
    const localPath = join(dir, fileName);
    await writeFile(localPath, input.audio);
    const message: ChannelMessage = {
      id: `discord-voice-${id}`,
      channel: "discord",
      sessionKey: input.sessionKey,
      text: "",
      sender: input.sender,
      attachments: [{
        id,
        kind: "voice",
        status: "ready",
        mimeType: input.mimeType ?? "audio/wav",
        originalName: input.originalName ?? fileName,
        localPath,
        bytes: input.audio.byteLength,
        metadata: { voiceChannel: true }
      }],
      receivedAt: this.#now().toISOString(),
      metadata: {
        ...(input.metadata ?? {}),
        voiceChannel: true,
      },
    };
    await this.#onVoiceMessage?.(message);
    return message;
  }

  async receiveOpusPackets(input: Omit<DiscordVoiceReceiveInput, "audio" | "mimeType" | "originalName"> & {
    packets: Buffer[];
  }): Promise<DiscordVoiceCommandResult> {
    const loaded = await this.#loadDependencies();
    if (!loaded.ok) {
      return setupError(
        "missing-optional-dependencies",
        `Discord voice receive needs optional packages: ${loaded.missing.join(", ")}. ${loaded.installHint}`,
        { missing: loaded.missing }
      );
    }
    if (loaded.deps.decodeOpusPacketsToWav === undefined) {
      return setupError(
        "missing-voice-decoder",
        "Discord voice receive needs an Opus decoder/packager before audio can be transcribed.",
        { missing: ["prism-media with an Opus decoder"] }
      );
    }
    if (input.packets.length === 0) {
      return setupError("empty-audio", "Discord voice receive did not collect any audio packets.");
    }
    let wav: Buffer;
    try {
      wav = await loaded.deps.decodeOpusPacketsToWav(input.packets);
    } catch {
      return setupError(
        "voice-decode-failed",
        "Discord voice receive could not decode Opus audio into a supported transcription file."
      );
    }
    await this.receiveAudio({
      sessionKey: input.sessionKey,
      sender: input.sender,
      audio: wav,
      mimeType: "audio/wav",
      originalName: "discord-voice.wav",
      metadata: input.metadata,
    });
    return { ok: true, content: "Discord voice audio received.", metadata: { bytes: wav.byteLength } };
  }

  #attachReceiver(
    connection: DiscordVoiceConnection,
    deps: DiscordVoiceOptionalDeps,
    input: DiscordVoiceJoinInput
  ): void {
    const receiver = connection.receiver as any;
    const speaking = receiver?.speaking;
    if (receiver === undefined || typeof speaking?.on !== "function" || typeof receiver.subscribe !== "function") {
      return;
    }
    speaking.on("start", (userId: string) => {
      const stream = receiver.subscribe(userId, {
        end: {
          behavior: deps.EndBehaviorType?.AfterSilence ?? "AfterSilence",
          duration: 1_000,
        }
      });
      const chunks: Buffer[] = [];
      stream.on?.("data", (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
      });
      stream.on?.("end", () => {
        if (chunks.length === 0) return;
        void this.receiveOpusPackets({
          sessionKey: {
            platform: "discord",
            chatId: input.textChannelId,
            accountId: input.guildId ?? undefined,
            userId,
            chatType: "channel",
          },
          sender: { id: userId },
          packets: chunks,
          metadata: {
            guildId: input.guildId,
            channelId: input.textChannelId,
            voiceChannelId: input.voiceChannel?.id,
          }
        }).then((result) => {
          if (!result.ok) {
            void Promise.resolve(this.#onVoiceReceiveError?.(result)).catch(() => {});
          }
        }).catch(() => {
          void Promise.resolve(this.#onVoiceReceiveError?.(setupError(
            "voice-decode-failed",
            "Discord voice receive could not decode Opus audio into a supported transcription file."
          ))).catch(() => {});
        });
      });
      stream.on?.("error", () => {
        // Voice receive is best-effort; text gateway handling must stay alive.
      });
    });
  }
}

export async function loadDiscordVoiceDependencies(): Promise<DiscordVoiceDependencyResult> {
  try {
    const specifier = "@discordjs/voice";
    const mod = await import(specifier) as {
      joinVoiceChannel?: DiscordVoiceOptionalDeps["joinVoiceChannel"];
      createAudioPlayer?: DiscordVoiceOptionalDeps["createAudioPlayer"];
      createAudioResource?: DiscordVoiceOptionalDeps["createAudioResource"];
      EndBehaviorType?: DiscordVoiceOptionalDeps["EndBehaviorType"];
    };
    const prismSpecifier = "prism-media";
    const prism = await import(prismSpecifier) as {
      default?: { opus?: { Decoder?: new (options: Record<string, unknown>) => NodeJS.ReadWriteStream } };
      opus?: { Decoder?: new (options: Record<string, unknown>) => NodeJS.ReadWriteStream };
    };
    const Decoder = prism.opus?.Decoder ?? prism.default?.opus?.Decoder;
    if (typeof mod.joinVoiceChannel !== "function" ||
      typeof mod.createAudioPlayer !== "function" ||
      typeof mod.createAudioResource !== "function" ||
      typeof Decoder !== "function") {
      return missingDependencies();
    }
    return {
      ok: true,
      deps: {
        joinVoiceChannel: mod.joinVoiceChannel,
        createAudioPlayer: mod.createAudioPlayer,
        createAudioResource: mod.createAudioResource,
        decodeOpusPacketsToWav: (packets) => decodeOpusPacketsToWav({ packets, Decoder }),
        EndBehaviorType: mod.EndBehaviorType,
      }
    };
  } catch {
    return missingDependencies();
  }
}

export function missingVoicePermissions(source: DiscordVoicePermissionSource | undefined): string[] {
  const missing: string[] = [];
  if (!hasPermission(source, "Connect")) missing.push("Connect");
  if (!hasPermission(source, "Speak")) missing.push("Speak");
  if (!hasPermission(source, "UseVAD")) missing.push("UseVAD");
  return missing;
}

function setupError(reason: string, content: string, metadata?: Record<string, unknown>): DiscordVoiceCommandResult {
  return { ok: false, reason, content, metadata };
}

function missingDependencies(): DiscordVoiceDependencyResult {
  return {
    ok: false,
    missing: [...OPTIONAL_VOICE_PACKAGES, "prism-media with an Opus decoder"],
    installHint: "Install the Discord voice stack in your local environment to use /voice channel.",
  };
}

function hasPermission(source: DiscordVoicePermissionSource | undefined, name: "Connect" | "Speak" | "UseVAD"): boolean {
  if (source === undefined) return false;
  if (typeof source.has === "function") {
    try {
      if (source.has(name)) return true;
    } catch {
      // Try object-style fields below.
    }
  }
  const lower = name === "UseVAD" ? "useVAD" : name.toLowerCase() as "connect" | "speak";
  return source[name] === true || source[lower] === true;
}

function firstConnection(connections: Map<string, StoredConnection>): StoredConnection | undefined {
  return connections.values().next().value;
}

function extensionForAudio(mimeType: string | undefined, originalName: string | undefined): string {
  const lowerName = originalName?.toLowerCase();
  if (lowerName?.endsWith(".ogg")) return ".ogg";
  if (lowerName?.endsWith(".opus")) return ".opus";
  if (lowerName?.endsWith(".wav")) return ".wav";
  if (mimeType === "audio/ogg" || mimeType === "audio/opus") return ".ogg";
  return ".wav";
}

async function decodeOpusPacketsToWav(input: {
  packets: Buffer[];
  Decoder: new (options: Record<string, unknown>) => NodeJS.ReadWriteStream;
}): Promise<Buffer> {
  const decoder = new input.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
  const pcmChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    decoder.on("data", (chunk: Buffer | Uint8Array) => {
      pcmChunks.push(Buffer.from(chunk));
    });
    decoder.on("end", resolve);
    decoder.on("error", reject);
    Readable.from(input.packets).pipe(decoder);
  });
  return wavFromPcm(Buffer.concat(pcmChunks), {
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
  });
}

function wavFromPcm(
  pcm: Buffer,
  options: { sampleRate: number; channels: number; bitsPerSample: number }
): Buffer {
  const byteRate = options.sampleRate * options.channels * options.bitsPerSample / 8;
  const blockAlign = options.channels * options.bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(options.channels, 22);
  header.writeUInt32LE(options.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(options.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
