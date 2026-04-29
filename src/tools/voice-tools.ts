import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type { RegisteredTool } from "../contracts/tool.js";

export type VoiceFetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export type VoiceToolOptions = {
  audioCacheRoot: string;
  artifactStore: ArtifactStore;
  tts?: LoadedRuntimeConfig["tts"];
  stt?: LoadedRuntimeConfig["stt"];
  fetch?: VoiceFetchLike;
  id?: () => string;
};

export function createVoiceTools(options: VoiceToolOptions): readonly RegisteredTool[] {
  const tts = options.tts ?? defaultTts();
  const stt = options.stt ?? defaultStt();

  return [
    {
      name: "voice.speak",
      description: "Generate speech audio from text using the configured TTS provider and record it as an audio artifact.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          voice: { type: "string" },
          model: { type: "string" },
          format: { type: "string" }
        },
        required: ["text"]
      },
      riskClass: tts.provider === "edge" || tts.provider === "neutts" || tts.provider === "kittentts"
        ? "workspace-write"
        : "external-side-effect",
      toolsets: ["media", "core"],
      progressLabel: "generating speech",
      maxResultSizeChars: 4000,
      isAvailable: () => true,
      run: async (input: { text?: string; voice?: string; model?: string; format?: string }, context) => {
        const text = input.text?.trim();
        if (text === undefined || text.length === 0) {
          return { ok: false, content: "voice.speak requires text." };
        }

        const result = await synthesizeSpeech({
          text,
          voice: input.voice,
          model: input.model,
          format: input.format,
          tts,
          fetch: options.fetch,
          signal: context?.signal
        });
        if (!result.ok) {
          return result;
        }

        await mkdir(options.audioCacheRoot, { recursive: true });
        const fileName = `${safeId(options.id?.() ?? randomUUID())}.${extensionForMime(result.mimeType)}`;
        const filePath = join(options.audioCacheRoot, fileName);
        await writeFile(filePath, result.bytes);
        const fileStat = await stat(filePath);
        const artifact = options.artifactStore.record({
          path: filePath,
          kind: "audio",
          bytes: fileStat.size,
          mimeType: result.mimeType,
          summary: `Speech generated from ${text.length} characters.`,
          metadata: {
            provider: tts.provider,
            model: result.model,
            voice: result.voice,
            format: result.mimeType
          }
        });

        return {
          ok: true,
          content: [
            `Generated speech: ${filePath}`,
            `Provider: ${tts.provider}`,
            `Model: ${result.model}`,
            `Voice: ${result.voice}`,
            `MIME: ${result.mimeType}`,
            `Artifact: ${artifact.id}`
          ].join("\n"),
          metadata: artifact
        };
      }
    },
    {
      name: "voice.transcribe",
      description: "Transcribe an audio file using the configured STT provider. Placeholder until STT execution providers are enabled.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          language: { type: "string" }
        },
        required: ["path"]
      },
      riskClass: stt.provider === "local" ? "read-only-local" : "external-side-effect",
      toolsets: ["media", "research"],
      progressLabel: "transcribing audio",
      maxResultSizeChars: 3000,
      isAvailable: () => true,
      run: async () => ({
        ok: false,
        content: `STT execution is not enabled yet. Configured provider: ${stt.provider}.`
      })
    }
  ];
}

async function synthesizeSpeech(input: {
  text: string;
  voice?: string;
  model?: string;
  format?: string;
  tts: LoadedRuntimeConfig["tts"];
  fetch?: VoiceFetchLike;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; bytes: Buffer; mimeType: string; model: string; voice: string }
  | { ok: false; content: string; metadata?: Record<string, unknown> }
> {
  if (input.tts.provider !== "openai") {
    return {
      ok: false,
      content: [
        `TTS execution for ${input.tts.provider} is not enabled yet.`,
        "Configured providers are visible through estacoda voice status.",
        "This first execution pass supports OpenAI-compatible TTS."
      ].join("\n"),
      metadata: {
        provider: input.tts.provider
      }
    };
  }

  const apiKeyEnv = input.tts.openai?.apiKeyEnv ?? "VOICE_TOOLS_OPENAI_KEY";
  const apiKey = process.env[apiKeyEnv] ?? (apiKeyEnv === "VOICE_TOOLS_OPENAI_KEY" ? process.env.OPENAI_API_KEY : undefined);
  if (apiKey === undefined || apiKey.length === 0) {
    return {
      ok: false,
      content: `Missing TTS API key. Export ${apiKeyEnv}${apiKeyEnv === "VOICE_TOOLS_OPENAI_KEY" ? " or OPENAI_API_KEY" : ""}.`,
      metadata: {
        provider: "openai",
        apiKeyEnv
      }
    };
  }

  const model = input.model ?? input.tts.openai?.model ?? "gpt-4o-mini-tts";
  const voice = input.voice ?? input.tts.openai?.voice ?? "alloy";
  const responseFormat = normalizeAudioFormat(input.format);
  const baseUrl = (input.tts.openai?.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await (input.fetch ?? globalVoiceFetch)(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      voice,
      input: input.text,
      response_format: responseFormat,
      speed: input.tts.openai?.speed ?? input.tts.speed
    }),
    signal: input.signal
  });

  if (!response.ok) {
    return {
      ok: false,
      content: `TTS request failed: ${response.status} ${response.statusText}\n${await response.text()}`,
      metadata: {
        provider: "openai",
        model,
        voice
      }
    };
  }

  return {
    ok: true,
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: mimeForAudioFormat(responseFormat),
    model,
    voice
  };
}

async function globalVoiceFetch(url: string, init?: Parameters<VoiceFetchLike>[1]): ReturnType<VoiceFetchLike> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    arrayBuffer: async () => await response.arrayBuffer(),
    text: async () => await response.text()
  };
}

function normalizeAudioFormat(value: string | undefined): "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm" {
  return value === "opus" || value === "aac" || value === "flac" || value === "wav" || value === "pcm" ? value : "mp3";
}

function mimeForAudioFormat(format: ReturnType<typeof normalizeAudioFormat>): string {
  switch (format) {
    case "opus":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    case "mp3":
      return "audio/mpeg";
  }
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "audio/wav":
      return "wav";
    case "audio/L16":
      return "pcm";
    default:
      return "mp3";
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "speech";
}

function defaultTts(): LoadedRuntimeConfig["tts"] {
  return {
    provider: "edge",
    speed: 1
  };
}

function defaultStt(): LoadedRuntimeConfig["stt"] {
  return {
    provider: "local"
  };
}
