import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPythonCapabilitySpecForTest,
  resetPythonCapabilityRegistryForTest
} from "./capability-registry.js";
import {
  checkManagedPythonCapabilityStatus,
  installManagedPythonCapabilityEnvironment,
  verifyManagedPythonCapabilityEnvironment
} from "./capability-manager.js";
import { resolveManagedPythonCapabilityPaths } from "./capability-paths.js";
import { boundDiagnostic, redactPythonEnvDiagnostic } from "./diagnostics.js";
import { writeManagedPythonCapabilityManifest } from "./manifest.js";
import { fingerprintManagedPythonCapabilitySpec } from "./spec-hash.js";
import type { ManagedPythonCapabilityEnvManifest } from "./manifest.js";
import type {
  PythonEnvCommandResult,
  PythonEnvCommandRunner
} from "./capability-manager.js";

type LockOptions = {
  lockDir: string;
  staleTimeoutMs?: number;
};

const lockMock = vi.hoisted(() => {
  const state = {
    lockOptions: [] as LockOptions[],
    acquired: true,
    acquireResults: [] as Array<{ acquired: boolean; stale?: boolean }>,
    acquireCalls: [] as string[],
    releaseCalls: [] as string[]
  };

  return {
    state,
    createFileCronJobLock: vi.fn((options: LockOptions) => {
      state.lockOptions.push(options);
      return {
        acquire: vi.fn(async (jobId: string) => {
          state.acquireCalls.push(jobId);
          return state.acquireResults.shift() ?? { acquired: state.acquired, stale: false };
        }),
        release: vi.fn(async (jobId: string) => {
          state.releaseCalls.push(jobId);
        }),
        isLocked: vi.fn(async () => false),
        staleSince: vi.fn(async () => undefined)
      };
    })
  };
});

vi.mock("../cron/cron-lock.js", () => ({
  createFileCronJobLock: lockMock.createFileCronJobLock
}));

describe("managed Python capability manager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "estacoda-python-capability-manager-test-"));
    resetPythonCapabilityRegistryForTest();
    lockMock.state.lockOptions = [];
    lockMock.state.acquired = true;
    lockMock.state.acquireResults = [];
    lockMock.state.acquireCalls = [];
    lockMock.state.releaseCalls = [];
    lockMock.createFileCronJobLock.mockClear();
  });

  afterEach(() => {
    resetPythonCapabilityRegistryForTest();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs a registered capability with no external packages and verifies a stdlib import", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-stdlib",
      version: "0.1.0",
      packages: [],
      verifyImports: ["json"]
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-stdlib",
      runner,
      now: fixedNow()
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toMatchObject({
        id: "fake-stdlib",
        version: "0.1.0",
        installedPackages: [],
        installedGroups: [],
        status: "verified",
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z",
        verifiedAt: "2026-06-13T00:00:00.000Z"
      });
    }
    expect(runner.calls.some((call) => call.args.slice(0, 3).join(" ") === "-m pip install")).toBe(false);
    expect(runner.calls).toContainEqual(expect.objectContaining({
      command: "python3",
      args: ["-m", "venv", join(tempDir, "python-envs", "fake-stdlib")]
    }));
    expect(runner.calls).toContainEqual(expect.objectContaining({
      command: join(tempDir, "python-envs", "fake-stdlib", "bin", "python"),
      args: expect.arrayContaining(["-c"])
    }));
  });

  it("installs exact pinned base packages from the registered spec", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-package",
      version: "0.1.0",
      packages: ["demo-package==1.2.3"],
      verifyImports: ["json"]
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-package",
      runner,
      now: fixedNow()
    });

    expect(result.ok).toBe(true);
    expect(runner.calls).toContainEqual(expect.objectContaining({
      command: join(tempDir, "python-envs", "fake-package", "bin", "python"),
      args: ["-m", "pip", "install", "demo-package==1.2.3"],
      options: expect.objectContaining({
        cwd: join(tempDir, "python-envs", "fake-package"),
        env: expect.objectContaining({
          PIP_CACHE_DIR: join(tempDir, "cache", "pip", "fake-package")
        })
      })
    }));
  });

  it("installs selected optional groups additively into the same capability env", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-extra",
      version: "0.1.0",
      packages: ["base-package==1.0.0"],
      verifyImports: ["json"],
      optionalGroups: {
        docs: {
          packages: ["doc-package==2.0.0"],
          verifyImports: ["pathlib"]
        }
      }
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-extra",
      groups: ["docs"],
      runner,
      now: fixedNow()
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installedGroups).toEqual(["docs"]);
      expect(result.installedPackages).toEqual(["base-package==1.0.0", "doc-package==2.0.0"]);
      expect(result.envPath).toBe(join(tempDir, "python-envs", "fake-extra"));
    }
    expect(runner.calls).toContainEqual(expect.objectContaining({
      command: join(tempDir, "python-envs", "fake-extra", "bin", "python"),
      args: ["-m", "pip", "install", "base-package==1.0.0", "doc-package==2.0.0"]
    }));
  });

  it("fails structurally for unknown optional groups", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-group-missing",
      version: "0.1.0",
      packages: [],
      verifyImports: [],
      optionalGroups: {}
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-group-missing",
      groups: ["unknown"],
      runner
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "not_configured",
      message: expect.stringContaining("Unknown optional group")
    });
    expect(runner.calls).toHaveLength(0);
  });

  it("reports installed, verified, upgrade_required, broken manifest, and missing venv status", async () => {
    const spec = {
      id: "fake-status",
      version: "0.1.0",
      packages: [],
      verifyImports: ["json"]
    };
    registerPythonCapabilitySpecForTest(spec);
    const paths = resolveManagedPythonCapabilityPaths({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    });

    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: false, reason: "install_required" });

    await writeFakePython(paths.pythonPath);
    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    }, manifestFor({
      id: "fake-status",
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      status: "installed"
    }));

    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: true, status: "installed" });

    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    }, manifestFor({
      id: "fake-status",
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      status: "verified"
    }));
    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: true, status: "verified" });

    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    }, manifestFor({
      id: "fake-status",
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      specHash: "old-hash",
      status: "verified"
    }));
    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: false, reason: "upgrade_required" });

    await writeFile(paths.manifestPath, "{not json", "utf8");
    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: false, reason: "broken_manifest" });

    rmSync(paths.pythonPath, { force: true });
    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    }, manifestFor({
      id: "fake-status",
      envPath: paths.envPath,
      pythonPath: join(paths.envPath, "bin", "missing-python"),
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      status: "verified"
    }));
    await expect(checkManagedPythonCapabilityStatus({
      stateRoot: tempDir,
      capabilityId: "fake-status"
    })).resolves.toMatchObject({ ok: false, reason: "venv_missing" });
  });

  it("uses a per-capability in-process and file lock so concurrent same-capability installs do not duplicate work", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-lock",
      version: "0.1.0",
      packages: ["lock-package==1"],
      verifyImports: ["json"]
    });
    let releaseVenv: (() => void) | undefined;
    const venvGate = new Promise<void>((resolve) => {
      releaseVenv = resolve;
    });
    const runner = createRunner(tempDir, {
      onVenv: async () => {
        await venvGate;
      }
    });

    const first = installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-lock",
      runner,
      now: fixedNow()
    });
    const second = installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-lock",
      runner,
      now: fixedNow()
    });
    releaseVenv?.();
    const results = await Promise.all([first, second]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(runner.calls.filter((call) => call.args[0] === "-m" && call.args[1] === "venv")).toHaveLength(1);
    expect(runner.calls.filter((call) => call.args.slice(0, 3).join(" ") === "-m pip install")).toHaveLength(1);
    expect(lockMock.state.acquireCalls).toEqual(["python-env:fake-lock"]);
  });

  it("uses separate lock ids for different capabilities", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-lock-a",
      version: "0.1.0",
      packages: [],
      verifyImports: ["json"]
    });
    registerPythonCapabilitySpecForTest({
      id: "fake-lock-b",
      version: "0.1.0",
      packages: [],
      verifyImports: ["json"]
    });
    const runner = createRunner(tempDir);

    await Promise.all([
      installManagedPythonCapabilityEnvironment({
        stateRoot: tempDir,
        capabilityId: "fake-lock-a",
        runner,
        now: fixedNow()
      }),
      installManagedPythonCapabilityEnvironment({
        stateRoot: tempDir,
        capabilityId: "fake-lock-b",
        runner,
        now: fixedNow()
      })
    ]);

    expect(lockMock.state.acquireCalls.sort()).toEqual(["python-env:fake-lock-a", "python-env:fake-lock-b"]);
    expect(runner.calls.filter((call) => call.args[0] === "-m" && call.args[1] === "venv")).toHaveLength(2);
  });

  it("reports missing Python before creating a venv", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-python-missing",
      version: "0.1.0",
      packages: [],
      verifyImports: []
    });
    const runner = createRunner(tempDir, { pythonMissing: true });

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-python-missing",
      runner
    });

    expect(result).toMatchObject({ ok: false, reason: "python_missing" });
    expect(runner.calls.filter((call) => call.args[0] === "-m" && call.args[1] === "venv")).toHaveLength(0);
  });

  it("reports venv creation failure", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-venv-failure",
      version: "0.1.0",
      packages: [],
      verifyImports: []
    });
    const runner = createRunner(tempDir, { venvFailure: "No module named ensurepip" });

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-venv-failure",
      runner,
      now: fixedNow()
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "venv_create_failed",
      diagnostic: expect.stringContaining("ensurepip")
    });
  });

  it("reports permission denied from command execution with redacted diagnostics", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-permission",
      version: "0.1.0",
      packages: [],
      verifyImports: []
    });
    const runner = createRunner(tempDir, {
      venvPermissionFailure: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"
    });

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-permission",
      runner,
      now: fixedNow()
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "permission_denied",
      diagnostic: expect.stringContaining("Authorization: [REDACTED]")
    });
    if (!result.ok) {
      expect(result.diagnostic).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    }
  });

  it("reports pip install failure with redacted bounded diagnostics", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-pip-failure",
      version: "0.1.0",
      packages: ["secret-package==1"],
      verifyImports: ["json"]
    });
    const runner = createRunner(tempDir, {
      pipFailure: `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456\n${"x".repeat(2_000)}`
    });

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-pip-failure",
      runner,
      now: fixedNow()
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "pip_install_failed",
      diagnostic: expect.stringContaining("[truncated]")
    });
    if (!result.ok) {
      expect(result.diagnostic).toContain("Authorization: [REDACTED]");
      expect(result.diagnostic).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    }
  });

  it("reports import verification failure", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-import-failure",
      version: "0.1.0",
      packages: [],
      verifyImports: ["missing_module"]
    });
    const runner = createRunner(tempDir, { importFailure: "ModuleNotFoundError: missing_module" });

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-import-failure",
      runner,
      now: fixedNow()
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "import_verify_failed",
      diagnostic: expect.stringContaining("missing_module")
    });
  });

  it("checks free disk before invoking venv or pip", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-disk",
      version: "0.1.0",
      packages: ["large-package==1"],
      verifyImports: ["json"],
      estimatedInstallSizeMb: 100
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-disk",
      runner,
      diskInfo: async () => ({ freeBytes: 10 }),
      now: fixedNow()
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "disk_insufficient",
      diagnostic: expect.stringContaining("required=")
    });
    expect(runner.calls.filter((call) => call.args[0] === "-m" && call.args[1] === "venv")).toHaveLength(0);
    expect(runner.calls.filter((call) => call.args.slice(0, 3).join(" ") === "-m pip install")).toHaveLength(0);
  });

  it("includes optional group estimates in the free disk guard", async () => {
    registerPythonCapabilitySpecForTest({
      id: "fake-disk-group",
      version: "0.1.0",
      packages: [],
      verifyImports: [],
      estimatedInstallSizeMb: 10,
      optionalGroups: {
        huge: {
          packages: ["huge==1"],
          verifyImports: [],
          estimatedInstallSizeMb: 90
        }
      }
    });
    const runner = createRunner(tempDir);

    const result = await installManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-disk-group",
      groups: ["huge"],
      runner,
      diskInfo: async () => ({ freeBytes: 99 * 1024 * 1024 }),
      now: fixedNow()
    });

    expect(result).toMatchObject({ ok: false, reason: "disk_insufficient" });
  });

  it("redacts and bounds Python environment diagnostics directly", () => {
    const raw = `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456\napi_key=secret-value\n${"x".repeat(2_000)}`;

    expect(redactPythonEnvDiagnostic(raw)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redactPythonEnvDiagnostic(raw)).not.toContain("secret-value");
    expect(boundDiagnostic(raw, 80)).toContain("[truncated]");
    expect(boundDiagnostic(raw, 80).length).toBeLessThanOrEqual(95);
  });

  it("verifies an installed capability without creating a venv or invoking pip", async () => {
    const spec = {
      id: "fake-verify-only",
      version: "0.1.0",
      packages: ["demo-package==1.2.3"],
      verifyImports: ["json"]
    };
    registerPythonCapabilitySpecForTest(spec);
    const paths = resolveManagedPythonCapabilityPaths({
      stateRoot: tempDir,
      capabilityId: "fake-verify-only"
    });
    await writeFakePython(paths.pythonPath);
    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: "fake-verify-only"
    }, {
      id: "fake-verify-only",
      version: "0.1.0",
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      installedPackages: ["demo-package==1.2.3"],
      installedGroups: [],
      pythonPath: paths.pythonPath,
      envPath: paths.envPath,
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
      status: "installed"
    });
    const runner = createRunner(tempDir);

    const result = await verifyManagedPythonCapabilityEnvironment({
      stateRoot: tempDir,
      capabilityId: "fake-verify-only",
      runner,
      now: fixedNow()
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.status).toBe("verified");
      expect(result.manifest.verifiedAt).toBe("2026-06-13T00:00:00.000Z");
    }
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({
      command: paths.pythonPath,
      args: expect.arrayContaining(["-c"])
    });
  });
});

type RunnerCall = {
  command: string;
  args: string[];
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number };
};

type RunnerOptions = {
  pythonMissing?: boolean;
  venvFailure?: string;
  venvPermissionFailure?: string;
  pipFailure?: string;
  importFailure?: string;
  onVenv?: () => Promise<void>;
};

function createRunner(tempDir: string, options: RunnerOptions = {}): PythonEnvCommandRunner & { calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner = (async (command, args, callOptions) => {
    calls.push({ command, args, options: callOptions });
    if ((command === "python3" || command === "python") && args.join(" ") === "-c import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)") {
      return options.pythonMissing === true
        ? fail("exit code 1")
        : ok();
    }
    if (args[0] === "-m" && args[1] === "venv") {
      if (options.venvPermissionFailure !== undefined) {
        return fail("permission denied", options.venvPermissionFailure, "", "EACCES");
      }
      if (options.venvFailure !== undefined) {
        return fail("exit code 1", options.venvFailure);
      }
      await options.onVenv?.();
      const envPath = args[2];
      if (envPath === undefined) {
        return fail("missing venv path");
      }
      await writeFakePython(join(envPath, "bin", "python"));
      return ok();
    }
    if (args[0] === "-m" && args[1] === "pip" && args[2] === "install") {
      if (options.pipFailure !== undefined) {
        return fail("exit code 1", options.pipFailure);
      }
      return ok();
    }
    if (args[0] === "-c") {
      if (options.importFailure !== undefined && command.startsWith(tempDir)) {
        return fail("exit code 1", options.importFailure);
      }
      return ok();
    }
    return ok();
  }) as PythonEnvCommandRunner & { calls: RunnerCall[] };
  runner.calls = calls;
  return runner;
}

function ok(stdout = "", stderr = ""): PythonEnvCommandResult {
  return { ok: true, stdout, stderr };
}

function fail(reason: string, stderr = "", stdout = "", code?: string): PythonEnvCommandResult {
  return { ok: false, reason, stderr, stdout, code };
}

async function writeFakePython(pythonPath: string): Promise<void> {
  await mkdir(dirname(pythonPath), { recursive: true });
  writeFileSync(pythonPath, "", "utf8");
}

function fixedNow(): () => Date {
  return () => new Date("2026-06-13T00:00:00.000Z");
}

function manifestFor(input: {
  id: string;
  specHash: string;
  envPath: string;
  pythonPath: string;
  status: ManagedPythonCapabilityEnvManifest["status"];
}): ManagedPythonCapabilityEnvManifest {
  return {
    id: input.id,
    version: "0.1.0",
    specHash: input.specHash,
    installedPackages: [],
    installedGroups: [],
    pythonPath: input.pythonPath,
    envPath: input.envPath,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    status: input.status
  };
}
