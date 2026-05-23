import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_AUDIO_INPUT_MAX_BYTES,
  validateAudioInput,
  validateAudioOutput
} from "./audio-validation.js";

describe("audio validation", () => {
  it("rejects non-existent files", async () => {
    const result = await validateAudioInput(join(tmpdir(), "missing-estacoda-audio.wav"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toContain("does not exist");
    }
  });

  it("rejects files over the default STT input size limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "estacoda-audio-validation-test-"));
    const path = join(dir, "large.wav");
    await writeFile(path, Buffer.alloc(DEFAULT_AUDIO_INPUT_MAX_BYTES + 1));

    const result = await validateAudioInput(path);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toContain(String(DEFAULT_AUDIO_INPUT_MAX_BYTES));
    }
  });

  it("rejects empty TTS provider output", () => {
    const result = validateAudioOutput(Buffer.alloc(0), { provider: "test" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toBe("test TTS returned empty audio.");
    }
  });
});
