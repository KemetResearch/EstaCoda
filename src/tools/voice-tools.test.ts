import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import {
  checkSttProviderStatus,
  checkTtsProviderStatus,
  createVoiceTools,
  type VoiceFetchLike
} from "./voice-tools.js";

function artifactStore(): ArtifactStore {
  let counter = 0;
  return new ArtifactStore({ id: () => `artifact-${++counter}` });
}

async function createRoots(): Promise<{ workspaceRoot: string; audioCacheRoot: string; outsideRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "estacoda-voice-test-"));
  const workspaceRoot = join(root, "workspace");
  const audioCacheRoot = join(root, "audio-cache");
  const outsideRoot = join(root, "outside");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(audioCacheRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  return { workspaceRoot, audioCacheRoot, outsideRoot };
}

async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    const value = updates[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function fakeOpenAiSpeechFetch(bytes = Buffer.from("audio")): VoiceFetchLike {
  return async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => JSON.stringify({ text: "transcript" })
  });
}

describe("voice tool readiness", () => {
  it("does not advertise edge TTS as available in Stage 0", async () => {
    const roots = await createRoots();
    const tts: LoadedRuntimeConfig["tts"] = { provider: "edge", speed: 1, enabled: true };
    const tools = createVoiceTools({
      ...roots,
      artifactStore: artifactStore(),
      tts,
      stt: { provider: "local", enabled: true, local: { command: "printf transcript" } }
    });

    const speak = tools.find((tool) => tool.name === "voice.speak");
    expect(speak?.isAvailable()).toBe(false);
    expect(checkTtsProviderStatus("edge", tts)).toEqual({
      ready: false,
      reason: "edge TTS is not implemented in v0.1.0 Stage 0"
    });
  });

  it("advertises OpenAI TTS only when a key is present", async () => {
    await withEnv({ VOICE_TOOLS_OPENAI_KEY: "sk-test", OPENAI_API_KEY: undefined }, async () => {
      const roots = await createRoots();
      const tts: LoadedRuntimeConfig["tts"] = {
        provider: "openai",
        enabled: true,
        speed: 1,
        openai: { apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY" }
      };
      const tools = createVoiceTools({
        ...roots,
        artifactStore: artifactStore(),
        tts,
        fetch: fakeOpenAiSpeechFetch()
      });

      const speak = tools.find((tool) => tool.name === "voice.speak");
      expect(speak?.isAvailable()).toBe(true);
      expect(checkTtsProviderStatus("openai", tts)).toEqual({ ready: true });
    });
  });

  it("returns disabled reasons for TTS and STT readiness", () => {
    expect(checkTtsProviderStatus("openai", { provider: "openai", enabled: false, speed: 1 })).toEqual({
      ready: false,
      reason: "TTS disabled"
    });
    expect(checkSttProviderStatus("local", { provider: "local", enabled: false })).toEqual({
      ready: false,
      reason: "STT disabled"
    });
  });

  it("does not advertise local STT without a command in Stage 0", async () => {
    await withEnv({ HERMES_LOCAL_STT_COMMAND: undefined }, async () => {
      const roots = await createRoots();
      const stt: LoadedRuntimeConfig["stt"] = { provider: "local", enabled: true };
      const tools = createVoiceTools({
        ...roots,
        artifactStore: artifactStore(),
        tts: { provider: "edge", enabled: true, speed: 1 },
        stt
      });

      const transcribe = tools.find((tool) => tool.name === "voice.transcribe");
      expect(transcribe?.isAvailable()).toBe(false);
      expect(checkSttProviderStatus("local", stt)).toEqual({
        ready: false,
        reason: "Local STT command not configured"
      });
    });
  });

  it("advertises local STT when a command is configured", async () => {
    const roots = await createRoots();
    const stt: LoadedRuntimeConfig["stt"] = {
      provider: "local",
      enabled: true,
      local: { command: "printf transcript" }
    };
    const tools = createVoiceTools({
      ...roots,
      artifactStore: artifactStore(),
      stt
    });

    const transcribe = tools.find((tool) => tool.name === "voice.transcribe");
    expect(transcribe?.isAvailable()).toBe(true);
    expect(checkSttProviderStatus("local", stt)).toEqual({ ready: true });
  });
});

describe("voice tool execution boundaries", () => {
  it("rejects transcription paths outside allowed roots", async () => {
    const roots = await createRoots();
    const outsideAudio = join(roots.outsideRoot, "voice.wav");
    await writeFile(outsideAudio, "audio");
    const transcribe = createVoiceTools({
      ...roots,
      artifactStore: artifactStore(),
      stt: { provider: "local", enabled: true, local: { command: "printf transcript" } }
    }).find((tool) => tool.name === "voice.transcribe");

    const result = await transcribe!.run({ path: outsideAudio });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("outside");
  });

  it("accepts transcription paths inside the workspace root", async () => {
    const roots = await createRoots();
    const audio = join(roots.workspaceRoot, "voice.wav");
    await writeFile(audio, "audio");
    const store = artifactStore();
    const transcribe = createVoiceTools({
      ...roots,
      artifactStore: store,
      stt: { provider: "local", enabled: true, local: { command: "printf transcript" } }
    }).find((tool) => tool.name === "voice.transcribe");

    const result = await transcribe!.run({ path: audio });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Transcript: transcript");
    expect(store.list()).toHaveLength(1);
  });

  it("accepts transcription paths inside the audio cache root", async () => {
    const roots = await createRoots();
    const audio = join(roots.audioCacheRoot, "voice.wav");
    await writeFile(audio, "audio");
    const store = artifactStore();
    const transcribe = createVoiceTools({
      ...roots,
      artifactStore: store,
      stt: { provider: "local", enabled: true, local: { command: "printf transcript" } }
    }).find((tool) => tool.name === "voice.transcribe");

    const result = await transcribe!.run({ path: audio });
    expect(result.ok).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it("records OpenAI speech output as an audio artifact", async () => {
    await withEnv({ VOICE_TOOLS_OPENAI_KEY: "sk-test", OPENAI_API_KEY: undefined }, async () => {
      const roots = await createRoots();
      const store = artifactStore();
      const speak = createVoiceTools({
        ...roots,
        artifactStore: store,
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY", model: "gpt-4o-mini-tts", voice: "alloy" }
        },
        fetch: fakeOpenAiSpeechFetch(Buffer.from("speech-bytes")),
        id: () => "speech-id"
      }).find((tool) => tool.name === "voice.speak");

      const result = await speak!.run({ text: "hello" });
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Provider: openai");
      const artifact = store.list()[0];
      expect(artifact.kind).toBe("audio");
      expect(artifact.mimeType).toBe("audio/mpeg");
      expect(await readFile(artifact.localPath!, "utf8")).toBe("speech-bytes");
    });
  });
});
