import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceStateManager } from "./voice-state.js";

async function createManager(now = Date.now): Promise<{ manager: VoiceStateManager; path: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "estacoda-voice-state-test-"));
  const path = join(root, "profiles", "default", "gateway", "voice-mode.json");
  await mkdir(join(root, "profiles", "default", "gateway"), { recursive: true });
  return {
    root,
    path,
    manager: new VoiceStateManager({ path, now })
  };
}

describe("VoiceStateManager", () => {
  it("persists and retrieves modes per platform/chat under profile gateway state", async () => {
    const { manager: first, path } = await createManager();
    await first.setMode("telegram", "chat-1", "voice_only");
    await first.setMode("discord", "chat-1", "all");

    const second = new VoiceStateManager({ path });

    expect(await second.getMode("telegram", "chat-1")).toBe("voice_only");
    expect(await second.getMode("discord", "chat-1")).toBe("all");
    expect(path).toContain(join("profiles", "default", "gateway", "voice-mode.json"));
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
      modes: {
        "telegram:chat-1": "voice_only",
        "discord:chat-1": "all"
      }
    });
  });

  it("recovers from malformed state and rewrites valid profile-local JSON", async () => {
    const { manager: voiceManager, path } = await createManager();
    await writeFile(path, "{ definitely not json", "utf8");

    expect(await voiceManager.getMode("telegram", "chat-1")).toBeUndefined();

    await voiceManager.setMode("telegram", "chat-1", "voice_only");

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
      modes: {
        "telegram:chat-1": "voice_only"
      }
    });
    const entries = await readdir(join(path, ".."));
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });

  it("shouldAutoTts returns true for explicitly enabled chats and false for disabled chats", async () => {
    const { manager: voiceManager } = await createManager();
    await voiceManager.setMode("telegram", "enabled", "voice_only");
    await voiceManager.setMode("telegram", "all", "all");
    await voiceManager.setMode("telegram", "disabled", "off");

    expect(await voiceManager.shouldAutoTts("telegram", "enabled", true, false)).toBe(true);
    expect(await voiceManager.shouldAutoTts("telegram", "enabled", false, false)).toBe(false);
    expect(await voiceManager.shouldAutoTts("telegram", "all", false, false)).toBe(true);
    expect(await voiceManager.shouldAutoTts("telegram", "disabled", true, true)).toBe(false);
  });

  it("falls back to voice.autoTts global default with true as voice_only and false as off", async () => {
    const { manager: voiceManager } = await createManager();

    expect(await voiceManager.resolveMode("telegram", "chat-1", true)).toBe("voice_only");
    expect(await voiceManager.resolveMode("telegram", "chat-1", false)).toBe("off");
    expect(await voiceManager.shouldAutoTts("telegram", "chat-1", true, true)).toBe(true);
    expect(await voiceManager.shouldAutoTts("telegram", "chat-1", false, true)).toBe(false);
    expect(await voiceManager.shouldAutoTts("telegram", "chat-1", true, false)).toBe(false);
  });

  it("drops identical transcript text within 12 seconds and later allows it", async () => {
    let now = 1_000;
    const { manager: voiceManager } = await createManager(() => now);

    voiceManager.recordTranscript("telegram", "chat-1", "Hello,   WORLD!");

    now += 5_000;
    expect(voiceManager.isDuplicateTranscript("telegram", "chat-1", "hello world")).toBe(true);

    now += 12_001;
    expect(voiceManager.isDuplicateTranscript("telegram", "chat-1", "hello world")).toBe(false);
  });

  it("allows distinct transcript text", async () => {
    const { manager: voiceManager } = await createManager();
    voiceManager.recordTranscript("telegram", "chat-1", "Please summarize the deployment plan.");

    expect(voiceManager.isDuplicateTranscript("telegram", "chat-1", "Please list tomorrow's calendar items.")).toBe(false);
  });

  it("drops near matches only when both normalized strings are long enough", async () => {
    const { manager: voiceManager } = await createManager();
    voiceManager.recordTranscript("telegram", "chat-1", "Please summarize the deployment plan for tomorrow morning");

    expect(voiceManager.isDuplicateTranscript("telegram", "chat-1", "Please summarize the deployment plan for tomorrow morning.")).toBe(true);
    expect(voiceManager.isDuplicateTranscript("telegram", "chat-1", "short text")).toBe(false);
  });
});
