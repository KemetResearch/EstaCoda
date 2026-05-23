import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChannelKind } from "../contracts/channel.js";

export type VoiceMode = "off" | "voice_only" | "all";

type VoiceModeFile = {
  version: 1;
  modes: Record<string, VoiceMode>;
};

type TranscriptEntry = {
  normalized: string;
  hash: string;
  timestampMs: number;
};

export type TranscriptRecord = {
  normalized: string;
  hash: string;
  timestamp: string;
};

export class VoiceStateManager {
  readonly #path: string;
  readonly #now: () => number;
  readonly #recentTranscripts = new Map<string, TranscriptEntry[]>();

  constructor(options: { path: string; now?: () => number }) {
    this.#path = options.path;
    this.#now = options.now ?? Date.now;
  }

  async getMode(platform: ChannelKind, chatId: string): Promise<VoiceMode | undefined> {
    const file = await this.#readFile();
    return file.modes[this.#key(platform, chatId)];
  }

  async setMode(platform: ChannelKind, chatId: string, mode: VoiceMode): Promise<void> {
    const file = await this.#readFile();
    file.modes[this.#key(platform, chatId)] = mode;
    await this.#writeFile(file);
  }

  async resolveMode(platform: ChannelKind, chatId: string, globalDefault: boolean): Promise<VoiceMode> {
    return await this.getMode(platform, chatId) ?? (globalDefault ? "voice_only" : "off");
  }

  async shouldAutoTts(
    platform: ChannelKind,
    chatId: string,
    incomingWasVoice: boolean,
    globalDefault: boolean
  ): Promise<boolean> {
    const mode = await this.resolveMode(platform, chatId, globalDefault);
    if (mode === "off") {
      return false;
    }
    if (mode === "all") {
      return true;
    }
    return incomingWasVoice;
  }

  isDuplicateTranscript(platform: ChannelKind, chatId: string, text: string): boolean {
    const key = this.#key(platform, chatId);
    const now = this.#now();
    const current = normalizeTranscript(text);
    if (current.length === 0) {
      return false;
    }
    const currentHash = hashTranscript(current);
    const recent = this.#freshEntries(key, now);
    for (const entry of recent) {
      if (entry.hash === currentHash || entry.normalized === current) {
        return true;
      }
      if (entry.normalized.length >= 16 && current.length >= 16 && similarityRatio(entry.normalized, current) >= 0.95) {
        return true;
      }
    }
    return false;
  }

  recordTranscript(platform: ChannelKind, chatId: string, text: string): TranscriptRecord {
    const key = this.#key(platform, chatId);
    const now = this.#now();
    const normalized = normalizeTranscript(text);
    const hash = hashTranscript(normalized);
    const fresh = this.#freshEntries(key, now);
    fresh.push({ normalized, hash, timestampMs: now });
    this.#recentTranscripts.set(key, fresh.slice(-5));
    return {
      normalized,
      hash,
      timestamp: new Date(now).toISOString()
    };
  }

  #freshEntries(key: string, now: number): TranscriptEntry[] {
    const cutoff = now - 12_000;
    const fresh = (this.#recentTranscripts.get(key) ?? []).filter((entry) => entry.timestampMs >= cutoff);
    this.#recentTranscripts.set(key, fresh.slice(-5));
    return fresh;
  }

  #key(platform: ChannelKind, chatId: string): string {
    return `${platform}:${chatId}`;
  }

  async #readFile(): Promise<VoiceModeFile> {
    try {
      const raw = await readFile(this.#path, "utf8");
      const parsed = JSON.parse(raw) as Partial<VoiceModeFile>;
      return {
        version: 1,
        modes: normalizeModes(parsed.modes)
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, modes: {} };
      }
      if (error instanceof SyntaxError) {
        return { version: 1, modes: {} };
      }
      throw error;
    }
  }

  async #writeFile(file: VoiceModeFile): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true });
    const tempPath = join(directory, `.voice-mode.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, this.#path);
  }
}

export function normalizeTranscript(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function hashTranscript(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function normalizeModes(value: unknown): Record<string, VoiceMode> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const modes: Record<string, VoiceMode> = {};
  for (const [key, mode] of Object.entries(value)) {
    if (mode === "off" || mode === "voice_only" || mode === "all") {
      modes[key] = mode;
    }
  }
  return modes;
}

function similarityRatio(left: string, right: string): number {
  const a = left.slice(0, 512);
  const b = right.slice(0, 512);
  if (a.length === 0 && b.length === 0) {
    return 1;
  }
  const common = longestCommonSubsequenceLength(a, b);
  return (2 * common) / (a.length + b.length);
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const previous = new Array<number>(b.length + 1).fill(0);
  const current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1] ?? 0);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return previous[b.length] ?? 0;
}
