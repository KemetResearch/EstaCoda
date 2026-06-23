import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGlobalStateHome, resolveProfileStateHome } from "../config/profile-home.js";
import { EDGE_TTS_CAPABILITY_ID } from "../python-env/capability-registry.js";
import { runCliCommand, type CliOptions } from "./cli.js";

const pythonEnvMock = vi.hoisted(() => ({
  checkManagedEnvironment: vi.fn(),
  createManagedEnvironment: vi.fn()
}));

const capabilityManagerMock = vi.hoisted(() => ({
  checkManagedPythonCapabilityStatus: vi.fn(),
  installManagedPythonCapabilityEnvironment: vi.fn()
}));

vi.mock("../python-env/manager.js", () => ({
  checkManagedEnvironment: pythonEnvMock.checkManagedEnvironment,
  createManagedEnvironment: pythonEnvMock.createManagedEnvironment
}));

vi.mock("../python-env/capability-manager.js", () => ({
  checkManagedPythonCapabilityStatus: capabilityManagerMock.checkManagedPythonCapabilityStatus,
  installManagedPythonCapabilityEnvironment: capabilityManagerMock.installManagedPythonCapabilityEnvironment
}));

function profileConfigPath(homeDir: string): string {
  return resolveProfileStateHome({ homeDir, profileId: "default" }).configPath;
}

function readyEdgeStatus(homeDir: string) {
  const stateRoot = resolveGlobalStateHome({ homeDir }).stateRoot;
  return {
    ok: true,
    status: "verified",
    capabilityId: EDGE_TTS_CAPABILITY_ID,
    version: "7.2.8",
    specHash: "edge-hash",
    installedGroups: [],
    installedPackages: ["edge-tts==7.2.8"],
    pythonPath: join(stateRoot, "python-envs", EDGE_TTS_CAPABILITY_ID, "bin", "python"),
    envPath: join(stateRoot, "python-envs", EDGE_TTS_CAPABILITY_ID),
    manifest: {
      id: EDGE_TTS_CAPABILITY_ID,
      version: "7.2.8",
      specHash: "edge-hash",
      installedPackages: ["edge-tts==7.2.8"],
      installedGroups: [],
      pythonPath: join(stateRoot, "python-envs", EDGE_TTS_CAPABILITY_ID, "bin", "python"),
      envPath: join(stateRoot, "python-envs", EDGE_TTS_CAPABILITY_ID),
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      verifiedAt: "2026-06-23T00:00:01.000Z",
      status: "verified",
    },
  };
}

function missingEdgeStatus() {
  return {
    ok: false,
    capabilityId: EDGE_TTS_CAPABILITY_ID,
    reason: "install_required",
    message: "Managed Python capability environment has not been installed.",
  };
}

async function writeProfileConfig(homeDir: string, config: unknown): Promise<void> {
  const path = profileConfigPath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config));
}

async function readProfileConfig(homeDir: string): Promise<any> {
  return JSON.parse(await readFile(profileConfigPath(homeDir), "utf8"));
}

async function runVoiceSetup(homeDir: string, argv: string[], overrides: Partial<CliOptions> = {}) {
  return await runCliCommand({
    argv: ["voice", "setup", ...argv],
    workspaceRoot: homeDir,
    homeDir,
    interactive: false,
    ...overrides
  });
}

describe("voice setup managed local STT", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "estacoda-voice-setup-"));
    await mkdir(join(homeDir, ".estacoda"), { recursive: true });
    pythonEnvMock.checkManagedEnvironment.mockReset();
    pythonEnvMock.createManagedEnvironment.mockReset();
    capabilityManagerMock.checkManagedPythonCapabilityStatus.mockReset();
    capabilityManagerMock.installManagedPythonCapabilityEnvironment.mockReset();
    capabilityManagerMock.checkManagedPythonCapabilityStatus.mockResolvedValue(readyEdgeStatus(homeDir));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("rejects missing values for python and voice setup flags", async () => {
    await expect(runVoiceSetup(homeDir, ["--python-binary"])).rejects.toThrow("Missing value for --python-binary");
    await expect(runVoiceSetup(homeDir, ["--stt-provider", "--tts-provider", "openai"])).rejects.toThrow("Missing value for --stt-provider");
  });

  it("keeps TTS-only setup from patching STT or touching the STT managed environment", async () => {
    await writeProfileConfig(homeDir, {
      stt: {
        provider: "local",
        local: {
          engine: "command",
          command: "existing-stt-command"
        }
      }
    });

    const result = await runVoiceSetup(homeDir, ["--tts-provider", "edge"]);

    expect(result.exitCode).toBe(0);
    expect(pythonEnvMock.checkManagedEnvironment).not.toHaveBeenCalled();
    expect(pythonEnvMock.createManagedEnvironment).not.toHaveBeenCalled();
    expect((await readProfileConfig(homeDir)).stt).toEqual({
      provider: "local",
      local: {
        engine: "command",
        command: "existing-stt-command"
      }
    });
  });

  it("prints the Edge TTS repair command without installing in non-interactive setup", async () => {
    capabilityManagerMock.checkManagedPythonCapabilityStatus.mockResolvedValue(missingEdgeStatus());

    const result = await runVoiceSetup(homeDir, ["--tts-provider", "edge"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Edge TTS setup uses EstaCoda's managed Python capability");
    expect(result.output).toContain("estacoda python-env setup edge-tts --yes");
    expect(result.output).toContain("estacoda python-env verify edge-tts");
    expect(capabilityManagerMock.installManagedPythonCapabilityEnvironment).not.toHaveBeenCalled();
    expect((await readProfileConfig(homeDir)).tts.provider).toBe("edge");
  });

  it("installs the Edge TTS capability after interactive confirmation without prompting for an API key", async () => {
    const stateRoot = resolveGlobalStateHome({ homeDir }).stateRoot;
    capabilityManagerMock.checkManagedPythonCapabilityStatus
      .mockResolvedValueOnce(missingEdgeStatus())
      .mockResolvedValueOnce(readyEdgeStatus(homeDir));
    capabilityManagerMock.installManagedPythonCapabilityEnvironment.mockResolvedValue(readyEdgeStatus(homeDir));
    const prompt = vi.fn(async (_question: string) => "");

    const result = await runVoiceSetup(homeDir, ["--tts-provider", "edge"], {
      interactive: true,
      prompt: Object.assign(prompt, { close: vi.fn() })
    });

    expect(result.exitCode).toBe(0);
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Install edge-tts now? [Y/n] "));
    expect(prompt.mock.calls.map((call) => call[0]).join("\n")).not.toContain("API key");
    expect(capabilityManagerMock.installManagedPythonCapabilityEnvironment).toHaveBeenCalledWith({
      stateRoot,
      capabilityId: EDGE_TTS_CAPABILITY_ID,
      onProgress: expect.any(Function)
    });
    expect(result.output).toContain("TTS readiness: ready");
    expect((await readProfileConfig(homeDir)).tts.provider).toBe("edge");
  });

  it("uses an already-ready managed Python environment without storing it as a custom override", async () => {
    pythonEnvMock.checkManagedEnvironment.mockResolvedValue({
      kind: "ready",
      pythonBinary: "/state/python-env/bin/python"
    });

    const result = await runVoiceSetup(homeDir, ["--stt-provider", "local", "--stt-model", "small"]);

    expect(result.exitCode).toBe(0);
    expect(pythonEnvMock.checkManagedEnvironment).toHaveBeenCalledTimes(1);
    expect(pythonEnvMock.createManagedEnvironment).not.toHaveBeenCalled();
    expect((await readProfileConfig(homeDir)).stt.local).toMatchObject({
      model: "small",
      engine: "faster-whisper",
      fasterWhisper: {
        enabled: true,
        model: "small",
        allowModelDownload: true
      }
    });
    expect((await readProfileConfig(homeDir)).stt.local).not.toHaveProperty("pythonBinary");
  });

  it("creates a missing managed Python environment without storing it as a custom override", async () => {
    pythonEnvMock.checkManagedEnvironment.mockResolvedValue({ kind: "missing" });
    pythonEnvMock.createManagedEnvironment.mockImplementation(async (_options, onProgress) => {
      onProgress?.("Creating managed Python environment...");
      onProgress?.("Installing faster-whisper==1.2.1...");
      onProgress?.("Managed Python environment ready.");
      return { ok: true, pythonBinary: "/state/python-env/bin/python" };
    });

    const result = await runVoiceSetup(homeDir, ["--stt-provider", "local"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Local STT setup will create EstaCoda's managed Python environment");
    expect(result.output).toContain("Installing faster-whisper==1.2.1...");
    expect(result.output).not.toContain("Collecting faster-whisper");
    expect((await readProfileConfig(homeDir)).stt.local).not.toHaveProperty("pythonBinary");
  });

  it("attempts creation for a corrupted managed Python environment", async () => {
    pythonEnvMock.checkManagedEnvironment.mockResolvedValue({ kind: "corrupted", reason: "import failed" });
    pythonEnvMock.createManagedEnvironment.mockResolvedValue({ ok: true, pythonBinary: "/state/python-env/bin/python" });

    const result = await runVoiceSetup(homeDir, ["--stt-provider", "local"]);

    expect(result.exitCode).toBe(0);
    expect(pythonEnvMock.createManagedEnvironment).toHaveBeenCalledTimes(1);
    expect((await readProfileConfig(homeDir)).stt.local).not.toHaveProperty("pythonBinary");
  });

  it("does not write local STT config when managed environment creation fails", async () => {
    await writeProfileConfig(homeDir, {});
    pythonEnvMock.checkManagedEnvironment.mockResolvedValue({ kind: "missing" });
    pythonEnvMock.createManagedEnvironment.mockResolvedValue({ ok: false, reason: "pip unavailable" });

    const result = await runVoiceSetup(homeDir, ["--stt-provider", "local"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Failed to set up local STT: pip unavailable");
    expect((await readProfileConfig(homeDir)).stt).toBeUndefined();
  });

  it("skips managed environment checks when a custom Python binary is provided", async () => {
    const result = await runVoiceSetup(homeDir, [
      "--stt-provider",
      "local",
      "--python-binary",
      "/x/python"
    ]);

    expect(result.exitCode).toBe(0);
    expect(pythonEnvMock.checkManagedEnvironment).not.toHaveBeenCalled();
    expect(pythonEnvMock.createManagedEnvironment).not.toHaveBeenCalled();
    expect((await readProfileConfig(homeDir)).stt.local.pythonBinary).toBe("/x/python");
  });

  it("prompts in interactive setup using the prompt function before creating the env", async () => {
    pythonEnvMock.checkManagedEnvironment.mockResolvedValue({ kind: "missing" });
    pythonEnvMock.createManagedEnvironment.mockResolvedValue({ ok: true, pythonBinary: "/state/python-env/bin/python" });
    const prompt = vi.fn(async () => "");

    const result = await runVoiceSetup(homeDir, ["--stt-provider", "local"], {
      interactive: true,
      prompt: Object.assign(prompt, { close: vi.fn() })
    });

    expect(result.exitCode).toBe(0);
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Continue? [Y/n] "));
    expect(pythonEnvMock.createManagedEnvironment).toHaveBeenCalledTimes(1);
  });
});
