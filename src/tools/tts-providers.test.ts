import { describe, expect, it } from "vitest";
import type { VoiceFetchLike } from "./voice-tools.js";
import {
  fetchVoiceProviderWithRetry,
  synthesizeSpeech
} from "./tts-providers.js";

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

describe("hosted TTS provider dispatch", () => {
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
