import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { resolveProfileStateHome } from "../config/profile-home.js";
import { EDGE_TTS_CAPABILITY_ID, requireRegisteredPythonCapabilitySpec } from "../python-env/capability-registry.js";
import { resolveManagedPythonCapabilityPaths } from "../python-env/capability-paths.js";
import { writeManagedPythonCapabilityManifest } from "../python-env/manifest.js";
import { fingerprintManagedPythonCapabilitySpec } from "../python-env/spec-hash.js";
import type { EdgeTtsRunInput } from "../tools/tts-providers.js";
import { runCliCommand } from "./cli.js";
import {
  cliVoiceModeStatePath,
  detectCliVoiceRecorder,
  playCliTtsResponse,
  readCliVoiceMode,
  recordAndTranscribeCliVoice
} from "./voice-mode.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createVerifiedEdgeCapabilityState(): Promise<string> {
  const stateRoot = await createTempDir("estacoda-cli-edge-state-");
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
  return stateRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CLI voice mode", () => {
  it("records audio under profile temp and transcribes it with a mocked recorder", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "estacoda-cli-voice-"));
    const profilePaths = resolveProfileStateHome({ homeDir, profileId: "default" });
    const config = await loadRuntimeConfig({ workspaceRoot: homeDir, homeDir, profileId: "default" });
    config.stt = {
      ...config.stt,
      provider: "local",
      local: { command: "mock-stt" }
    };
    const recorder = {
      record: vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "wav");
        return { ok: true as const };
      })
    };
    const transcriber = vi.fn(async ({ path }: { path: string }) => {
      expect((await readFile(path, "utf8"))).toBe("wav");
      return { ok: true as const, text: "hello from the microphone", model: "mock-stt" };
    });

    const result = await recordAndTranscribeCliVoice({
      config,
      profilePaths,
      recorder,
      transcriber,
      id: () => "turn-1",
      envOptions: {
        env: {},
        platform: "darwin",
        commandExists: async (command) => command === "sox"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      transcript: "hello from the microphone",
      model: "mock-stt"
    });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(transcriber).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(resolve(result.audioPath).startsWith(resolve(profilePaths.tempPath))).toBe(true);
      expect(result.audioPath).toContain("/audio/cli-voice/");
      await expect(stat(result.audioPath)).resolves.toMatchObject({ size: 3 });
    }
  });

  it("reports SSH microphone capture as unavailable", async () => {
    const result = await detectCliVoiceRecorder({
      env: { SSH_TTY: "/dev/pts/1" },
      platform: "linux",
      commandExists: async () => true
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("SSH")
    });
  });

  it("skips optional playback cleanly when no local player is available", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "estacoda-cli-voice-playback-"));
    const profilePaths = resolveProfileStateHome({ homeDir, profileId: "default" });
    const config = await loadRuntimeConfig({ workspaceRoot: homeDir, homeDir, profileId: "default" });

    const result = await playCliTtsResponse({
      text: "hello",
      config,
      profilePaths,
      commandExists: async () => false
    });

    expect(result).toEqual({ ok: true, played: false, reason: "no-local-audio-player" });
  });

  it("passes managed Python state and profile audio temp root into Edge playback synthesis", async () => {
    const homeDir = await createTempDir("estacoda-cli-voice-edge-");
    const profilePaths = resolveProfileStateHome({ homeDir, profileId: "default" });
    const config = await loadRuntimeConfig({ workspaceRoot: homeDir, homeDir, profileId: "default" });
    config.tts = {
      provider: "edge",
      enabled: true,
      speed: 1.25,
      edge: { voice: "en-US-AriaNeural" }
    };
    const pythonStateRoot = await createVerifiedEdgeCapabilityState();
    const runner = vi.fn(async (input: EdgeTtsRunInput) => {
      await writeFile(input.outputPath, Buffer.from("edge-audio"));
      return { ok: true as const, outputPath: input.outputPath, mimeType: "audio/mpeg" };
    });
    const playedPaths: string[] = [];

    const result = await playCliTtsResponse({
      text: "hello",
      config,
      profilePaths,
      pythonStateRoot,
      edgeTtsRunner: runner,
      commandExists: async (command) => command === "afplay",
      playCommand: async (_command, args) => {
        playedPaths.push(String(args[0]));
        return { ok: true };
      },
      id: () => "edge-cli-1"
    });

    expect(result).toEqual({ ok: true, played: true, player: "afplay" });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      rate: "+25%",
      outputPath: expect.stringContaining(join(profilePaths.tempPath, "audio"))
    }));
    expect(playedPaths[0]).toContain(join(profilePaths.tempPath, "audio", "auto-tts"));
    await expect(stat(playedPaths[0]!)).rejects.toThrow();
  });

  it("parses estacoda voice mode on/off/tts/status and persists profile-local state", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "estacoda-cli-voice-command-"));
    const workspaceRoot = homeDir;
    const voiceModeEnv = {
      platform: "linux" as const,
      commandExists: async () => false
    };

    const on = await runCliCommand({ argv: ["voice", "mode", "on"], workspaceRoot, homeDir, voiceModeEnv });
    expect(on.exitCode).toBe(0);
    expect(on.output).toContain("CLI voice mode: on.");
    const profilePaths = resolveProfileStateHome({ homeDir, profileId: "default" });
    expect(await readCliVoiceMode(profilePaths)).toBe("on");

    const tts = await runCliCommand({ argv: ["voice", "mode", "tts"], workspaceRoot, homeDir, voiceModeEnv });
    expect(tts.exitCode).toBe(0);
    expect(await readCliVoiceMode(profilePaths)).toBe("tts");

    const status = await runCliCommand({ argv: ["voice", "mode", "status"], workspaceRoot, homeDir, voiceModeEnv });
    expect(status.exitCode).toBe(0);
    expect(status.output).toContain("EstaCoda CLI voice mode");
    expect(status.output).toContain("Mode: tts");
    expect(status.output).toContain(cliVoiceModeStatePath(profilePaths));

    const off = await runCliCommand({ argv: ["voice", "mode", "off"], workspaceRoot, homeDir, voiceModeEnv });
    expect(off.exitCode).toBe(0);
    expect(await readCliVoiceMode(profilePaths)).toBe("off");
  });
});
