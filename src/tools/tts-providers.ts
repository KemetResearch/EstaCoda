import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoadedRuntimeConfig, TtsProvider } from "../config/runtime-config.js";
import { EDGE_TTS_CAPABILITY_ID } from "../python-env/capability-registry.js";
import { resolveCapabilityPythonEnv } from "../python-env/capability-resolver.js";
import { boundDiagnostic } from "../python-env/diagnostics.js";
import type { VoiceFetchLike } from "./voice-tools.js";
import { validateAudioOutput } from "./audio-validation.js";
import { formatMissingOpenAiAudioCredential, resolveOpenAiAudioCredential } from "./audio-credentials.js";

export type EdgeTtsRunInput = {
  pythonPath: string;
  workerPath: string;
  text: string;
  voice: string;
  rate: string;
  outputPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  spawnProcess?: EdgeTtsSubprocessSpawn;
};

export type EdgeTtsRunResult =
  | { ok: true; outputPath: string; mimeType: string }
  | { ok: false; content: string; metadata?: Record<string, unknown> };

export type EdgeTtsRunner = (input: EdgeTtsRunInput) => Promise<EdgeTtsRunResult>;

export type EdgeTtsSubprocess = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): EdgeTtsSubprocess;
  on(event: "error", listener: (error: Error) => void): EdgeTtsSubprocess;
};

export type EdgeTtsSubprocessSpawn = (
  command: string,
  args: string[],
  options: {
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
    env: NodeJS.ProcessEnv;
  }
) => EdgeTtsSubprocess;

export type SpeechSynthesisInput = {
  text: string;
  voice?: string;
  model?: string;
  format?: string;
  tts: LoadedRuntimeConfig["tts"];
  fetch?: VoiceFetchLike;
  signal?: AbortSignal;
  pythonStateRoot?: string;
  tempRoot?: string;
  edgeTtsRunner?: EdgeTtsRunner;
};

export type SpeechSynthesisResult =
  | { ok: true; bytes: Buffer; mimeType: string; model: string; voice: string }
  | { ok: false; content: string; metadata?: Record<string, unknown> };

type ProviderFetchResult =
  | { ok: true; response: Awaited<ReturnType<VoiceFetchLike>> }
  | { ok: false; content: string; metadata?: Record<string, unknown> };

const EDGE_TTS_REPAIR_HINT = [
  "Edge TTS is configured but its managed Python capability is not installed.",
  "Run: estacoda python-env setup edge-tts --yes"
].join("\n");
const EDGE_TTS_WORKER_TIMEOUT_MS = 60_000;
const EDGE_TTS_STDOUT_LIMIT_CHARS = 64_000;
const EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS = 1_200;

export const TTS_PROVIDER_CAPS: Record<TtsProvider, number | undefined> = {
  openai: 4096,
  elevenlabs: 5000,
  minimax: 4096,
  gemini: 4096,
  xai: 4096,
  edge: 5000,
  mistral: 4096,
  neutts: 4096,
  kittentts: 4096
};

export function getTtsTextCap(input: {
  provider: TtsProvider;
  tts: LoadedRuntimeConfig["tts"];
  model?: string;
}): number | undefined {
  if (input.provider === "elevenlabs") {
    return elevenLabsCap(input.model ?? input.tts.elevenlabs?.modelId);
  }
  return TTS_PROVIDER_CAPS[input.provider];
}

export function elevenLabsCap(modelId?: string): number {
  return modelId?.includes("turbo") ? 2000 : 5000;
}

export function edgeRateForSpeed(speed: number): string {
  const percent = Math.round((speed - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

export async function synthesizeSpeech(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  switch (input.tts.provider) {
    case "openai":
      return synthesizeOpenAi(input);
    case "elevenlabs":
      return synthesizeElevenLabs(input);
    case "minimax":
      return synthesizeMiniMax(input);
    case "gemini":
      return synthesizeGemini(input);
    case "xai":
      return synthesizeXai(input);
    case "edge":
      return synthesizeEdge(input);
    case "mistral":
    case "neutts":
    case "kittentts":
      return {
        ok: false,
        content: [
          `TTS execution for ${input.tts.provider} is not enabled yet.`,
          "Configured providers are visible through estacoda voice status.",
          "This execution pass supports hosted TTS providers: openai, elevenlabs, minimax, gemini, xai, and edge."
        ].join("\n"),
        metadata: { provider: input.tts.provider }
      };
  }
}

export async function fetchVoiceProviderWithRetry(
  fetchLike: VoiceFetchLike,
  url: string,
  init: Parameters<VoiceFetchLike>[1],
  options: {
    provider: string;
    maxRetries?: number;
    delayMs?: number;
  }
): ReturnType<VoiceFetchLike> {
  const maxRetries = options.maxRetries ?? 2;
  const delayMs = options.delayMs ?? 25;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchLike(url, init);
      if (!isRetryableStatus(response.status) || attempt === maxRetries) {
        return response;
      }
      await sleepBeforeRetry(delayMs, attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt === maxRetries) {
        throw error;
      }
      await sleepBeforeRetry(delayMs, attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${options.provider} TTS request failed`);
}

async function synthesizeOpenAi(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "openai";
  const apiKeyEnv = input.tts.openai?.apiKeyEnv ?? "VOICE_TOOLS_OPENAI_KEY";
  const credential = resolveOpenAiAudioCredential(apiKeyEnv);
  if (!credential.ok) {
    return missingKey(provider, credential.configuredApiKeyEnv, credential.missingApiKeyEnvs);
  }

  const model = input.model ?? input.tts.openai?.model ?? "gpt-4o-mini-tts";
  const voice = input.voice ?? input.tts.openai?.voice ?? "alloy";
  const responseFormat = normalizeAudioFormat(input.format);
  const baseUrl = (input.tts.openai?.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchProvider({
    provider,
    fetch: input.fetch,
    url: `${baseUrl}/audio/speech`,
    sensitiveText: input.text,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.apiKey}`,
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
    }
  });
  if (!response.ok) {
    return response;
  }

  return audioResult({
    provider,
    bytes: Buffer.from(await response.response.arrayBuffer()),
    mimeType: mimeForAudioFormat(responseFormat),
    model,
    voice
  });
}

async function synthesizeElevenLabs(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "elevenlabs";
  const apiKeyEnv = input.tts.elevenlabs?.apiKeyEnv ?? "ELEVENLABS_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return missingKey(provider, apiKeyEnv);
  }

  const voice = input.voice ?? input.tts.elevenlabs?.voiceId ?? "pNInz6obpgDQGcFmaJgB";
  const model = input.model ?? input.tts.elevenlabs?.modelId ?? "eleven_multilingual_v2";
  const response = await fetchProvider({
    provider,
    fetch: input.fetch,
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
    sensitiveText: input.text,
    init: {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text: input.text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      }),
      signal: input.signal
    }
  });
  if (!response.ok) {
    return response;
  }

  return audioResult({
    provider,
    bytes: Buffer.from(await response.response.arrayBuffer()),
    mimeType: "audio/mpeg",
    model,
    voice
  });
}

async function synthesizeMiniMax(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "minimax";
  const apiKeyEnv = input.tts.minimax?.apiKeyEnv ?? "MINIMAX_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return missingKey(provider, apiKeyEnv);
  }

  const model = input.model ?? input.tts.minimax?.model ?? "speech-2.8-hd";
  const voice = input.voice ?? input.tts.minimax?.voiceId ?? "English_Graceful_Lady";
  const response = await fetchProvider({
    provider,
    fetch: input.fetch,
    url: "https://api.minimax.chat/v1/t2a_v2",
    sensitiveText: input.text,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        text: input.text,
        voice_setting: {
          voice_id: voice,
          speed: input.tts.minimax?.speed ?? 1,
          vol: input.tts.minimax?.vol ?? 1,
          pitch: input.tts.minimax?.pitch ?? 0
        }
      }),
      signal: input.signal
    }
  });
  if (!response.ok) {
    return response;
  }

  const raw = await response.response.text();
  const audio = firstStringAtPath(tryJson(raw), [
    ["data", "audio"],
    ["data", "audio_base64"],
    ["data", "audio_file"],
    ["audio"],
    ["audio_base64"],
    ["audio_file"]
  ]);
  if (audio === undefined) {
    return malformedResponse(provider, "MiniMax TTS response did not include audio data.", { model, voice });
  }

  return audioResult({
    provider,
    bytes: Buffer.from(audio, "base64"),
    mimeType: "audio/mpeg",
    model,
    voice
  });
}

async function synthesizeGemini(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "gemini";
  const apiKeyEnv = input.tts.gemini?.apiKeyEnv ?? "GEMINI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return missingKey(provider, apiKeyEnv);
  }

  const model = input.model ?? input.tts.gemini?.model ?? "gemini-2.5-flash-preview-tts";
  const voice = input.voice ?? input.tts.gemini?.voice ?? "Kore";
  const response = await fetchProvider({
    provider,
    fetch: input.fetch,
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    sensitiveText: input.text,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      }),
      signal: input.signal
    }
  });
  if (!response.ok) {
    return response;
  }

  const raw = await response.response.text();
  const parsed = tryJson(raw);
  const inlineData = extractGeminiInlineData(parsed);
  if (inlineData?.data === undefined) {
    return malformedResponse(provider, "Gemini TTS response did not include inline audio data.", { model, voice });
  }

  return audioResult({
    provider,
    bytes: Buffer.from(inlineData.data, "base64"),
    mimeType: inlineData.mimeType ?? "audio/wav",
    model,
    voice
  });
}

async function synthesizeXai(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "xai";
  const apiKeyEnv = input.tts.xai?.apiKeyEnv ?? "XAI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return missingKey(provider, apiKeyEnv);
  }

  const voice = input.voice ?? input.tts.xai?.voiceId ?? "eve";
  const model = "xai-tts";
  const format = normalizeAudioFormat(input.format);
  const sampleRate = input.tts.xai?.sampleRate ?? 24_000;
  const bitRate = input.tts.xai?.bitRate ?? 128_000;
  const body: Record<string, unknown> = {
    text: input.text,
    voice_id: voice,
    language: input.tts.xai?.language ?? "en"
  };
  const speed = input.tts.xai?.speed;
  if (speed !== undefined && speed !== 1) {
    body.speed = speed;
  }
  if (format !== "mp3" || sampleRate !== 24_000 || bitRate !== 128_000) {
    body.output_format = {
      codec: format,
      sample_rate: sampleRate,
      bit_rate: bitRate
    };
  }

  const baseUrl = (input.tts.xai?.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
  const response = await fetchProvider({
    provider,
    fetch: input.fetch,
    url: `${baseUrl}/tts`,
    sensitiveText: input.text,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: input.signal
    }
  });
  if (!response.ok) {
    return response;
  }

  return audioResult({
    provider,
    bytes: Buffer.from(await response.response.arrayBuffer()),
    mimeType: mimeForAudioFormat(format),
    model,
    voice
  });
}

async function synthesizeEdge(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const provider = "edge";
  const voice = input.voice ?? input.tts.edge?.voice ?? "en-US-AriaNeural";
  const speed = input.tts.edge?.speed ?? input.tts.speed ?? 1;
  const rate = edgeRateForSpeed(speed);

  if (input.pythonStateRoot === undefined || input.tempRoot === undefined) {
    return {
      ok: false,
      content: [
        "Edge TTS requires EstaCoda's managed Python edge-tts capability.",
        "No managed Python state root or temporary output root was available."
      ].join("\n"),
      metadata: {
        provider,
        reason: "managed-python-context-missing"
      }
    };
  }

  const capability = await resolveCapabilityPythonEnv(EDGE_TTS_CAPABILITY_ID, {
    stateRoot: input.pythonStateRoot
  });
  if (!capability.ok) {
    return {
      ok: false,
      content: EDGE_TTS_REPAIR_HINT,
      metadata: {
        provider,
        reason: "managed-python-capability-unavailable",
        capabilityReason: capability.reason,
        repairCommand: "estacoda python-env setup edge-tts --yes",
        diagnostic: capability.diagnostic === undefined
          ? undefined
          : sanitizeProviderErrorBody(capability.diagnostic, input.text, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS)
      }
    };
  }

  await mkdir(input.tempRoot, { recursive: true });
  const workDir = await mkdtemp(join(input.tempRoot, "edge-tts-"));
  const outputPath = join(workDir, "speech.mp3");
  try {
    const runner = input.edgeTtsRunner ?? runEdgeTtsWorker;
    const result = await runner({
      pythonPath: capability.pythonPath,
      workerPath: defaultEdgeTtsWorkerPath(),
      text: input.text,
      voice,
      rate,
      outputPath,
      signal: input.signal
    });
    if (!result.ok) {
      return edgeTtsFailure(provider, result, input.text);
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(result.outputPath);
    } catch (error) {
      return {
        ok: false,
        content: "Edge TTS worker did not produce readable audio output.",
        metadata: {
          provider,
          reason: "worker-protocol-error",
          error: sanitizeProviderErrorBody(stableErrorMessage(error), input.text)
        }
      };
    }
    return audioResult({
      provider,
      bytes,
      mimeType: result.mimeType || "audio/mpeg",
      model: "edge",
      voice
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runEdgeTtsWorker(input: EdgeTtsRunInput): Promise<EdgeTtsRunResult> {
  if (input.signal?.aborted === true) {
    return edgeTtsWorkerFailure("Edge TTS worker was aborted.", "worker-aborted");
  }

  return await new Promise<EdgeTtsRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const spawnProcess = input.spawnProcess ?? (spawn as EdgeTtsSubprocessSpawn);
    const child = spawnProcess(input.pythonPath, [input.workerPath], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      input.signal?.removeEventListener("abort", onAbort);
    };
    const settle = (result: EdgeTtsRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const killAndSettle = (result: EdgeTtsRunResult) => {
      child.kill();
      settle(result);
    };
    const onAbort = () => {
      killAndSettle(edgeTtsWorkerFailure("Edge TTS worker was aborted.", "worker-aborted"));
    };

    timer = setTimeout(() => {
      killAndSettle(edgeTtsWorkerFailure(
        `Edge TTS worker timed out after ${input.timeoutMs ?? EDGE_TTS_WORKER_TIMEOUT_MS}ms.`,
        "worker-timeout"
      ));
    }, input.timeoutMs ?? EDGE_TTS_WORKER_TIMEOUT_MS);

    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, String(chunk), EDGE_TTS_STDOUT_LIMIT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundDiagnostic(`${stderr}${String(chunk)}`, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS);
    });
    child.on("error", (error) => {
      settle(edgeTtsWorkerFailure(
        `Edge TTS worker failed to start: ${boundDiagnostic(error.message, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS)}`,
        "worker-protocol-error"
      ));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      const parsed = parseEdgeTtsWorkerResponse(stdout);
      if (parsed.ok && code === 0) {
        settle(parsed.value);
        return;
      }
      if (parsed.ok && !parsed.value.ok) {
        settle(parsed.value);
        return;
      }
      const diagnostic = stderr.length === 0 ? "No diagnostic output was captured." : stderr;
      settle(edgeTtsWorkerFailure(
        `Edge TTS worker protocol failure: ${boundDiagnostic(parsed.ok ? diagnostic : parsed.error, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS)}`,
        "worker-protocol-error",
        diagnostic
      ));
    });

    child.stdin.end(`${JSON.stringify({
      text: input.text,
      voice: input.voice,
      rate: input.rate,
      outputPath: input.outputPath
    })}\n`);
  });
}

export function defaultEdgeTtsWorkerPath(): string {
  return edgeTtsWorkerPathFromModuleUrl(import.meta.url);
}

export function edgeTtsWorkerPathFromModuleUrl(moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl));
  return join(here, "../../workers/edge-tts/edge-tts-worker.py");
}

async function fetchProvider(input: {
  provider: string;
  fetch?: VoiceFetchLike;
  url: string;
  init: Parameters<VoiceFetchLike>[1];
  sensitiveText?: string;
}): Promise<ProviderFetchResult> {
  let response: Awaited<ReturnType<VoiceFetchLike>>;
  try {
    response = await fetchVoiceProviderWithRetry(input.fetch ?? globalVoiceFetch, input.url, input.init, {
      provider: input.provider
    });
  } catch (error) {
    return {
      ok: false,
      content: `${input.provider} TTS request failed: ${stableErrorMessage(error)}`,
      metadata: {
        provider: input.provider,
        reason: "network-error"
      }
    };
  }

  if (!response.ok) {
    const body = sanitizeProviderErrorBody(await response.text(), input.sensitiveText);
    return {
      ok: false,
      content: [
        `${input.provider} TTS request failed: ${response.status} ${response.statusText}`,
        body.length === 0 ? undefined : `Provider response: ${body}`
      ].filter((line) => line !== undefined).join("\n"),
      metadata: {
        provider: input.provider,
        status: response.status,
        reason: "tts-request-failed"
      }
    };
  }

  return { ok: true, response };
}

async function globalVoiceFetch(url: string, init?: Parameters<VoiceFetchLike>[1]): ReturnType<VoiceFetchLike> {
  const response = await fetch(url, init as RequestInit);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    arrayBuffer: async () => await response.arrayBuffer(),
    text: async () => await response.text()
  };
}

function audioResult(input: {
  provider: string;
  bytes: Buffer;
  mimeType: string;
  model: string;
  voice: string;
}): SpeechSynthesisResult {
  const validation = validateAudioOutput(input.bytes, { provider: input.provider });
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    bytes: input.bytes,
    mimeType: input.mimeType,
    model: input.model,
    voice: input.voice
  };
}

function missingKey(provider: string, apiKeyEnv: string, fallbackEnvs: readonly string[] = [apiKeyEnv]): SpeechSynthesisResult {
  return {
    ok: false,
    content: `Missing TTS API key. Export ${formatMissingOpenAiAudioCredential(fallbackEnvs)}.`,
    metadata: {
      provider,
      apiKeyEnv
    }
  };
}

function malformedResponse(provider: string, content: string, metadata: Record<string, unknown>): SpeechSynthesisResult {
  return {
    ok: false,
    content,
    metadata: {
      provider,
      ...metadata
    }
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

function tryJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function firstStringAtPath(value: unknown, paths: readonly (readonly string[])[]): string | undefined {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      current = isRecord(current) ? current[key] : undefined;
    }
    if (typeof current === "string" && current.length > 0) {
      return current;
    }
  }
  return undefined;
}

function extractGeminiInlineData(value: unknown): { data?: string; mimeType?: string } | undefined {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    return undefined;
  }
  for (const candidate of value.candidates) {
    const content = isRecord(candidate) ? candidate.content : undefined;
    const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) {
        continue;
      }
      const inlineData = isRecord(part.inlineData)
        ? part.inlineData
        : (isRecord(part.inline_data) ? part.inline_data : undefined);
      if (inlineData !== undefined && typeof inlineData.data === "string") {
        return {
          data: inlineData.data,
          mimeType: typeof inlineData.mimeType === "string"
            ? inlineData.mimeType
            : (typeof inlineData.mime_type === "string" ? inlineData.mime_type : undefined)
        };
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = typeof (error as Error & { code?: unknown }).code === "string"
    ? String((error as Error & { code?: string }).code).toUpperCase()
    : "";
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "UND_ERR_SOCKET") {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("connection reset") ||
    message.includes("network reset");
}

async function sleepBeforeRetry(baseDelayMs: number, attempt: number): Promise<void> {
  if (baseDelayMs <= 0) {
    return;
  }
  const jitter = Math.floor(Math.random() * baseDelayMs);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(baseDelayMs * (2 ** attempt) + jitter, 250)));
}

function stableErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "network error";
}

function edgeTtsWorkerFailure(
  content: string,
  reason: "worker-protocol-error" | "worker-timeout" | "worker-aborted" | "synthesis-error",
  diagnostic?: string
): EdgeTtsRunResult {
  return {
    ok: false,
    content,
    metadata: {
      reason,
      ...(diagnostic === undefined ? {} : { diagnostic: boundDiagnostic(diagnostic, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS) })
    }
  };
}

function edgeTtsFailure(provider: string, result: Extract<EdgeTtsRunResult, { ok: false }>, sensitiveText: string): SpeechSynthesisResult {
  const reason = stableEdgeTtsReason(result.metadata?.reason);
  const diagnostic = typeof result.metadata?.diagnostic === "string"
    ? sanitizeProviderErrorBody(result.metadata.diagnostic, sensitiveText, EDGE_TTS_DIAGNOSTIC_LIMIT_CHARS)
    : undefined;
  return {
    ok: false,
    content: sanitizeProviderErrorBody(result.content, sensitiveText) || "Edge TTS synthesis failed.",
    metadata: {
      provider,
      reason,
      ...(diagnostic === undefined || diagnostic.length === 0 ? {} : { diagnostic })
    }
  };
}

function stableEdgeTtsReason(reason: unknown): string {
  return reason === "managed-python-context-missing" ||
    reason === "managed-python-capability-unavailable" ||
    reason === "worker-protocol-error" ||
    reason === "worker-timeout" ||
    reason === "worker-aborted" ||
    reason === "synthesis-error" ||
    reason === "empty-audio-output"
    ? reason
    : "synthesis-error";
}

function parseEdgeTtsWorkerResponse(stdout: string): { ok: true; value: EdgeTtsRunResult } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, error: `Invalid Edge TTS worker JSON: ${stableErrorMessage(error)}` };
  }
  if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
    return { ok: false, error: "Edge TTS worker response was malformed." };
  }
  if (parsed.ok) {
    if (typeof parsed.outputPath !== "string" || parsed.outputPath.length === 0) {
      return { ok: false, error: "Edge TTS worker success response did not include outputPath." };
    }
    return {
      ok: true,
      value: {
        ok: true,
        outputPath: parsed.outputPath,
        mimeType: typeof parsed.mimeType === "string" && parsed.mimeType.length > 0 ? parsed.mimeType : "audio/mpeg"
      }
    };
  }
  return {
    ok: true,
    value: {
      ok: false,
      content: typeof parsed.content === "string" && parsed.content.length > 0 ? parsed.content : "Edge TTS synthesis failed.",
      metadata: isRecord(parsed.metadata) ? parsed.metadata : { reason: "synthesis-error" }
    }
  };
}

function appendBounded(current: string, chunk: string, maxChars: number): string {
  const combined = `${current}${chunk}`;
  if (combined.length <= maxChars) {
    return combined;
  }
  return `${combined.slice(0, maxChars)}...[truncated]`;
}

function sanitizeProviderErrorBody(value: string, sensitiveText: string | undefined, maxChars = 240): string {
  const compact = value
    .replace(/sk-[a-zA-Z0-9_-]+/gu, "[redacted]")
    .replace(/Bearer\s+[a-zA-Z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/api[_-]?key["':=\s]+[a-zA-Z0-9._~+/=-]+/giu, "api_key=[redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  const redacted = sensitiveText === undefined || sensitiveText.trim().length === 0
    ? compact
    : compact.replaceAll(sensitiveText, "[redacted]");
  return redacted.slice(0, maxChars);
}
