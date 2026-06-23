import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDGE_TTS_CAPABILITY_ID, requireRegisteredPythonCapabilitySpec } from "../python-env/capability-registry.js";
import { resolveManagedPythonCapabilityPaths } from "../python-env/capability-paths.js";
import { writeManagedPythonCapabilityManifest } from "../python-env/manifest.js";
import { fingerprintManagedPythonCapabilitySpec } from "../python-env/spec-hash.js";
import type { VoiceFetchLike } from "./voice-tools.js";
import {
  defaultEdgeTtsWorkerPath,
  edgeRateForSpeed,
  edgeTtsWorkerPathFromModuleUrl,
  fetchVoiceProviderWithRetry,
  getTtsTextCap,
  runEdgeTtsWorker,
  synthesizeSpeech
} from "./tts-providers.js";
import type { EdgeTtsRunInput, EdgeTtsSubprocessSpawn } from "./tts-providers.js";

type CapturedRequest = {
  url: string;
  init?: Parameters<VoiceFetchLike>[1];
};

function response(input: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  bytes?: Buffer;
  text?: string;
} = {}): Awaited<ReturnType<VoiceFetchLike>> {
  const bytes = input.bytes ?? Buffer.from("audio-bytes");
  const text = input.text ?? "";
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    statusText: input.statusText ?? "OK",
    arrayBuffer: async () => {
      const arrayBuffer = new ArrayBuffer(bytes.length);
      new Uint8Array(arrayBuffer).set(bytes);
      return arrayBuffer;
    },
    text: async () => text
  };
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

function captureFetch(result: Awaited<ReturnType<VoiceFetchLike>>): { fetch: VoiceFetchLike; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return result;
    }
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createVerifiedEdgeCapabilityState(): Promise<{ stateRoot: string; tempRoot: string; pythonPath: string }> {
  const stateRoot = await createTempDir("estacoda-edge-tts-state-");
  const tempRoot = await createTempDir("estacoda-edge-tts-temp-");
  const paths = resolveManagedPythonCapabilityPaths({
    stateRoot,
    capabilityId: EDGE_TTS_CAPABILITY_ID
  });
  await mkdir(dirname(paths.pythonPath), { recursive: true });
  await writeFile(paths.pythonPath, "", "utf8");
  const spec = requireRegisteredPythonCapabilitySpec(EDGE_TTS_CAPABILITY_ID);
  await writeManagedPythonCapabilityManifest({
    stateRoot,
    capabilityId: EDGE_TTS_CAPABILITY_ID
  }, {
    id: EDGE_TTS_CAPABILITY_ID,
    version: spec.version,
    specHash: fingerprintManagedPythonCapabilitySpec(spec),
    installedPackages: [...spec.packages],
    installedGroups: [],
    pythonPath: paths.pythonPath,
    envPath: paths.envPath,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    verifiedAt: "2026-06-23T00:00:01.000Z",
    status: "verified"
  });
  return { stateRoot, tempRoot, pythonPath: paths.pythonPath };
}

function edgeTtsConfig(speed = 1, edgeSpeed?: number) {
  return {
    provider: "edge" as const,
    enabled: true,
    speed,
    edge: {
      voice: "en-US-AriaNeural",
      ...(edgeSpeed === undefined ? {} : { speed: edgeSpeed })
    }
  };
}

describe("hosted TTS provider dispatch", () => {
  it("resolves OpenAI audio keys from configured env before voice and OpenAI fallbacks", async () => {
    await withEnv({
      CUSTOM_OPENAI_AUDIO_KEY: "configured-key",
      VOICE_TOOLS_OPENAI_KEY: "voice-key",
      OPENAI_API_KEY: "openai-key"
    }, async () => {
      const captured = captureFetch(response({ bytes: Buffer.from("openai-audio") }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "CUSTOM_OPENAI_AUDIO_KEY" }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(captured.requests[0]?.init?.headers).toMatchObject({ authorization: "Bearer configured-key" });
    });
  });

  it("uses VOICE_TOOLS_OPENAI_KEY when a custom OpenAI audio env is missing", async () => {
    await withEnv({
      CUSTOM_OPENAI_AUDIO_KEY: undefined,
      VOICE_TOOLS_OPENAI_KEY: "voice-key",
      OPENAI_API_KEY: "openai-key"
    }, async () => {
      const captured = captureFetch(response({ bytes: Buffer.from("openai-audio") }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "CUSTOM_OPENAI_AUDIO_KEY" }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(captured.requests[0]?.init?.headers).toMatchObject({ authorization: "Bearer voice-key" });
    });
  });

  it("uses OPENAI_API_KEY only when the configured OpenAI audio env is the default voice key", async () => {
    await withEnv({
      CUSTOM_OPENAI_AUDIO_KEY: undefined,
      VOICE_TOOLS_OPENAI_KEY: undefined,
      OPENAI_API_KEY: "openai-key"
    }, async () => {
      const allowed = captureFetch(response({ bytes: Buffer.from("openai-audio") }));
      const allowedResult = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY" }
        },
        fetch: allowed.fetch
      });
      expect(allowedResult.ok).toBe(true);
      expect(allowed.requests[0]?.init?.headers).toMatchObject({ authorization: "Bearer openai-key" });

      const blocked = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "CUSTOM_OPENAI_AUDIO_KEY" }
        },
        fetch: async () => {
          throw new Error("custom missing env must not fall back to OPENAI_API_KEY");
        }
      });
      expect(blocked).toMatchObject({
        ok: false,
        metadata: { provider: "openai", apiKeyEnv: "CUSTOM_OPENAI_AUDIO_KEY" }
      });
    });
  });

  it("dispatches ElevenLabs synthesis to the voice endpoint and returns bytes", async () => {
    await withEnv({ ELEVENLABS_API_KEY: "eleven-key" }, async () => {
      const captured = captureFetch(response({ bytes: Buffer.from("eleven-audio") }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "elevenlabs",
          enabled: true,
          speed: 1,
          elevenlabs: { voiceId: "voice-1", modelId: "eleven_multilingual_v2", apiKeyEnv: "ELEVENLABS_API_KEY" }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.bytes.toString()).toBe("eleven-audio");
      expect(captured.requests[0]?.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1");
      expect(captured.requests[0]?.init?.headers).toMatchObject({ "xi-api-key": "eleven-key" });
    });
  });

  it("decodes MiniMax base64 audio responses", async () => {
    await withEnv({ MINIMAX_API_KEY: "minimax-key" }, async () => {
      const audio = Buffer.from("minimax-audio").toString("base64");
      const captured = captureFetch(response({ text: JSON.stringify({ data: { audio } }) }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "minimax",
          enabled: true,
          speed: 1,
          minimax: { model: "speech-2.8-hd", voiceId: "English_Graceful_Lady", apiKeyEnv: "MINIMAX_API_KEY" }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.bytes.toString()).toBe("minimax-audio");
      expect(captured.requests[0]?.url).toBe("https://api.minimax.chat/v1/t2a_v2");
    });
  });

  it("extracts Gemini inline audio data and sends the configured voice name", async () => {
    await withEnv({ GEMINI_API_KEY: "gemini-key" }, async () => {
      const audio = Buffer.from("gemini-audio").toString("base64");
      const captured = captureFetch(response({
        text: JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { data: audio, mimeType: "audio/wav" } }] } }
          ]
        })
      }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "gemini",
          enabled: true,
          speed: 1,
          gemini: { model: "gemini-2.5-flash-preview-tts", voice: "Kore", apiKeyEnv: "GEMINI_API_KEY" }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.bytes.toString()).toBe("gemini-audio");
      const body = JSON.parse(String(captured.requests[0]?.init?.body));
      expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
      expect(captured.requests[0]?.url).toContain("models/gemini-2.5-flash-preview-tts:generateContent");
    });
  });

  it("uses the xAI native /tts endpoint and native config shape", async () => {
    await withEnv({ XAI_API_KEY: "xai-key" }, async () => {
      const captured = captureFetch(response({ bytes: Buffer.from("xai-audio") }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "xai",
          enabled: true,
          speed: 1,
          xai: {
            voiceId: "eve",
            language: "en",
            sampleRate: 24_000,
            bitRate: 128_000,
            baseUrl: "https://api.x.ai/v1",
            apiKeyEnv: "XAI_API_KEY",
            speed: 1.2
          }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.bytes.toString()).toBe("xai-audio");
      expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/tts");
      expect(captured.requests[0]?.init?.headers).toMatchObject({ authorization: "Bearer xai-key" });
      const body = JSON.parse(String(captured.requests[0]?.init?.body));
      expect(body).toMatchObject({ text: "hello", voice_id: "eve", language: "en", speed: 1.2 });
      expect(body).not.toHaveProperty("model");
    });
  });

  it("keeps OpenAI synthesis behavior working through dispatch", async () => {
    await withEnv({ VOICE_TOOLS_OPENAI_KEY: "openai-key", OPENAI_API_KEY: undefined }, async () => {
      const captured = captureFetch(response({ bytes: Buffer.from("openai-audio") }));
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: {
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            baseUrl: "https://api.openai.com/v1",
            apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY"
          }
        },
        fetch: captured.fetch
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.bytes.toString()).toBe("openai-audio");
      expect(captured.requests[0]?.url).toBe("https://api.openai.com/v1/audio/speech");
      const body = JSON.parse(String(captured.requests[0]?.init?.body));
      expect(body).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy", input: "hello" });
    });
  });

  it("requires managed Python context for Edge synthesis", async () => {
    const result = await synthesizeSpeech({
      text: "hello",
      tts: edgeTtsConfig()
    });

    expect(result).toMatchObject({
      ok: false,
      metadata: { provider: "edge", reason: "managed-python-context-missing" }
    });
  });

  it("returns a repair hint when the Edge TTS capability is missing", async () => {
    const stateRoot = await createTempDir("estacoda-edge-tts-missing-state-");
    const tempRoot = await createTempDir("estacoda-edge-tts-missing-temp-");
    const sensitiveText = "do not leak this synthesis text";
    const runner = vi.fn();
    const result = await synthesizeSpeech({
      text: sensitiveText,
      tts: edgeTtsConfig(1.25),
      pythonStateRoot: stateRoot,
      tempRoot,
      edgeTtsRunner: runner
    });

    expect(result).toMatchObject({
      ok: false,
      content: [
        "Edge TTS is configured but its managed Python capability is not installed.",
        "Run: estacoda python-env setup edge-tts --yes"
      ].join("\n"),
      metadata: { provider: "edge", reason: "managed-python-capability-unavailable" }
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveText);
    expect(runner).not.toHaveBeenCalled();
  });

  it("dispatches Edge synthesis through the managed Python worker and reads MP3 bytes", async () => {
    const state = await createVerifiedEdgeCapabilityState();
    const runner = vi.fn(async (input: EdgeTtsRunInput) => {
      await writeFile(input.outputPath, Buffer.from("edge-audio"));
      return { ok: true as const, outputPath: input.outputPath, mimeType: "audio/mpeg" };
    });

    const result = await synthesizeSpeech({
      text: "hello",
      tts: edgeTtsConfig(1.25),
      pythonStateRoot: state.stateRoot,
      tempRoot: state.tempRoot,
      edgeTtsRunner: runner
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.bytes.toString()).toBe("edge-audio");
    expect(result.ok && result.mimeType).toBe("audio/mpeg");
    expect(result.ok && result.model).toBe("edge");
    expect(result.ok && result.voice).toBe("en-US-AriaNeural");
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      pythonPath: state.pythonPath,
      workerPath: defaultEdgeTtsWorkerPath(),
      text: "hello",
      voice: "en-US-AriaNeural",
      rate: "+25%"
    }));
  });

  it("prefers configured Edge speed overrides", async () => {
    const state = await createVerifiedEdgeCapabilityState();
    const runner = vi.fn(async (input: EdgeTtsRunInput) => {
      await writeFile(input.outputPath, Buffer.from("edge-audio"));
      return { ok: true as const, outputPath: input.outputPath, mimeType: "audio/mpeg" };
    });

    await synthesizeSpeech({
      text: "hello",
      tts: edgeTtsConfig(1, 0.8),
      pythonStateRoot: state.stateRoot,
      tempRoot: state.tempRoot,
      edgeTtsRunner: runner
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      rate: "-20%"
    }));
  });

  it("maps worker synthesis failures without leaking synthesis text", async () => {
    const state = await createVerifiedEdgeCapabilityState();
    const sensitiveText = "never echo this exact text";
    const runner = vi.fn(async () => ({
      ok: false as const,
      content: `Edge TTS synthesis failed: ${sensitiveText}`,
      metadata: {
        reason: "synthesis-error",
        diagnostic: `provider echoed ${sensitiveText}`
      }
    }));

    const result = await synthesizeSpeech({
      text: sensitiveText,
      tts: edgeTtsConfig(),
      pythonStateRoot: state.stateRoot,
      tempRoot: state.tempRoot,
      edgeTtsRunner: runner
    });

    expect(result).toMatchObject({
      ok: false,
      metadata: { provider: "edge", reason: "synthesis-error" }
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveText);
    expect(JSON.stringify(result)).toContain("[redacted]");
  });

  it("rejects empty Edge worker output", async () => {
    const state = await createVerifiedEdgeCapabilityState();
    const runner = vi.fn(async (input: EdgeTtsRunInput) => {
      await writeFile(input.outputPath, Buffer.alloc(0));
      return { ok: true as const, outputPath: input.outputPath, mimeType: "audio/mpeg" };
    });

    const result = await synthesizeSpeech({
      text: "hello",
      tts: edgeTtsConfig(),
      pythonStateRoot: state.stateRoot,
      tempRoot: state.tempRoot,
      edgeTtsRunner: runner
    });

    expect(result).toMatchObject({
      ok: false,
      metadata: { provider: "edge", reason: "empty-audio-output", bytes: 0 }
    });
  });

  it("spawns the Edge TTS worker with shell disabled", async () => {
    let capturedOptions: Parameters<EdgeTtsSubprocessSpawn>[2] | undefined;
    const spawnProcess: EdgeTtsSubprocessSpawn = (_command, _args, options) => {
      capturedOptions = options;
      const events = new EventEmitter();
      const child = {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
        on: (event: "close" | "error", listener: (...args: any[]) => void) => {
          events.on(event, listener);
          return child;
        }
      };
      setTimeout(() => {
        child.stdout.write(JSON.stringify({ ok: true, outputPath: "/tmp/speech.mp3", mimeType: "audio/mpeg" }));
        child.stdout.end();
        events.emit("close", 0, null);
      }, 0);
      return child;
    };

    const result = await runEdgeTtsWorker({
      pythonPath: "/state/python-envs/edge-tts/bin/python",
      workerPath: defaultEdgeTtsWorkerPath(),
      text: "hello",
      voice: "en-US-AriaNeural",
      rate: "+0%",
      outputPath: "/tmp/speech.mp3",
      spawnProcess
    });

    expect(result).toEqual({ ok: true, outputPath: "/tmp/speech.mp3", mimeType: "audio/mpeg" });
    expect(capturedOptions).toMatchObject({ shell: false, stdio: ["pipe", "pipe", "pipe"] });
  });

  it("resolves Edge TTS worker paths for source and packaged execution", () => {
    expect(defaultEdgeTtsWorkerPath()).toContain(join("workers", "edge-tts", "edge-tts-worker.py"));
    const packagedUrl = pathToFileURL(join("/tmp", "estacoda-package", "dist", "tools", "tts-providers.js")).toString();
    expect(edgeTtsWorkerPathFromModuleUrl(packagedUrl)).toBe(join(
      "/tmp",
      "estacoda-package",
      "workers",
      "edge-tts",
      "edge-tts-worker.py"
    ));
  });

  it("fails structurally when a TTS provider returns empty audio", async () => {
    await withEnv({ VOICE_TOOLS_OPENAI_KEY: "openai-key", OPENAI_API_KEY: undefined }, async () => {
      const result = await synthesizeSpeech({
        text: "hello",
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY" }
        },
        fetch: captureFetch(response({ bytes: Buffer.alloc(0) })).fetch
      });

      expect(result).toMatchObject({
        ok: false,
        metadata: { provider: "openai", reason: "empty-audio-output", bytes: 0 }
      });
    });
  });

  it("caps and sanitizes hosted TTS provider error bodies", async () => {
    await withEnv({ VOICE_TOOLS_OPENAI_KEY: "openai-key", OPENAI_API_KEY: undefined }, async () => {
      const sensitiveText = "please read this private request text";
      const result = await synthesizeSpeech({
        text: sensitiveText,
        tts: {
          provider: "openai",
          enabled: true,
          speed: 1,
          openai: { apiKeyEnv: "VOICE_TOOLS_OPENAI_KEY" }
        },
        fetch: captureFetch(response({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: [
            `echoed input: ${sensitiveText}`,
            "api_key: sk-test-secret",
            "x".repeat(400)
          ].join("\n")
        })).fetch
      });

      expect(result).toMatchObject({
        ok: false,
        metadata: {
          provider: "openai",
          status: 400,
          reason: "tts-request-failed"
        }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.content).not.toContain("sk-test-secret");
        expect(result.content).not.toContain(sensitiveText);
        expect(result.content).toContain("[redacted]");
        expect(result.content.length).toBeLessThan(340);
      }
    });
  });
});

describe("Edge TTS helpers", () => {
  it("formats Edge rate strings with explicit signs", () => {
    expect(edgeRateForSpeed(1)).toBe("+0%");
    expect(edgeRateForSpeed(1.25)).toBe("+25%");
    expect(edgeRateForSpeed(0.8)).toBe("-20%");
  });

  it("uses a 5000 character text cap for Edge", () => {
    expect(getTtsTextCap({
      provider: "edge",
      tts: { provider: "edge", enabled: true, speed: 1 }
    })).toBe(5000);
  });
});

describe("hosted TTS retry helper", () => {
  it("retries 429 and 5xx responses", async () => {
    const statuses = [429, 500, 200];
    let calls = 0;
    const fetch: VoiceFetchLike = async () => {
      const status = statuses[calls++] ?? 200;
      return response({ ok: status === 200, status, statusText: status === 200 ? "OK" : "retry" });
    };

    const result = await fetchVoiceProviderWithRetry(fetch, "https://example.test/tts", {}, {
      provider: "test",
      delayMs: 0
    });

    expect(result.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("retries network reset and timeout style failures", async () => {
    let calls = 0;
    const fetch: VoiceFetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("connection reset by peer") as Error & { code: string };
        error.code = "ECONNRESET";
        throw error;
      }
      return response();
    };

    const result = await fetchVoiceProviderWithRetry(fetch, "https://example.test/tts", {}, {
      provider: "test",
      delayMs: 0
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not retry auth or validation failures", async () => {
    let calls = 0;
    const fetch: VoiceFetchLike = async () => {
      calls += 1;
      return response({ ok: false, status: 401, statusText: "Unauthorized" });
    };

    const result = await fetchVoiceProviderWithRetry(fetch, "https://example.test/tts", {}, {
      provider: "test",
      delayMs: 0
    });

    expect(result.status).toBe(401);
    expect(calls).toBe(1);
  });
});
